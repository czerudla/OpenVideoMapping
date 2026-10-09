// Tron – světelné motorky (stavová animace `sim`, formát r8). 2–4 motorky jezdí po pravoúhlé mřížce uvnitř oblasti,
// nechávají za sebou zářící stěnu a kdo narazí, vybuchne. Po zbytku jednoho hráče následuje oslava a nové kolo.
// Hodnota buňky: 0 = volno, 1–4 = stopa hráče, 250–254 = výbuch (doznívá), 255 = stěna mimo oblast.
// Veškerý stav motorek je v poli, ve vyhrazených řádcích za mřížkou hřiště (META bajtů):
//   motorka i: [i*6] x, y, směr (0 nahoru, 1 doprava, 2 dolů, 3 doleva), živá (1/0), stáří po výbuchu (kroky);
//   [24] počet motorek, [25] fáze (0 hra, 1 oslava), [26] čítač oslavy, [27] vítěz (255 = nikdo), [28–31] seed.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 96; // buněk na delší straně oblasti
const META = 32; // bajtů stavu za hřištěm
const WALL = 255;
const EXPLOSION = 250; // 250–254 podle stáří výbuchu
const TURN_PROB = 0.05; // šance na zatočení i bez překážky
const FLOOD_LIMIT = 50; // dosah vyhodnocení volného místa
const CELEBRATE_STEPS = 24; // ~2 s při 12 krocích za sekundu
const FADE_STEPS = 12; // za jak dlouho zmizí stopa vybuchlé motorky (~1 s)
const MAX_BIKES = 4;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

// Dočasná paměť pro flood-fill v rámci jednoho volání (žádný stav mezi kroky).
const queue = new Int32Array(FLOOD_LIMIT + 4);
let visited = new Uint32Array(0);
let stamp = 0;

function metaRows(w) {
  return Math.ceil(META / w);
}

// Počet volných buněk dosažitelných z (x, y) (včetně ní), nejvýše `limit`. Buňka (x, y) musí být volná.
function flood(g, w, fh, x, y, limit) {
  if (visited.length < w * fh) visited = new Uint32Array(w * fh);
  stamp++;
  let head = 0, tail = 0;
  queue[tail++] = y * w + x;
  visited[y * w + x] = stamp;
  while (head < tail && tail < limit) {
    const i = queue[head++];
    const cx = i % w, cy = (i - cx) / w;
    for (let d = 0; d < 4 && tail < limit; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= fh) continue;
      const j = ny * w + nx;
      if (g[j] !== 0 || visited[j] === stamp) continue;
      visited[j] = stamp;
      queue[tail++] = j;
    }
  }
  return tail;
}

function isFree(g, w, fh, x, y) {
  return x >= 0 && y >= 0 && x < w && y < fh && g[y * w + x] === 0;
}

// Volné místo ve směru d z pozice (x, y), 0 pokud je tam překážka.
function room(g, w, fh, x, y, d, limit) {
  const nx = x + DX[d], ny = y + DY[d];
  return isFree(g, w, fh, nx, ny) ? flood(g, w, fh, nx, ny, limit) : 0;
}

// Rozhodne o směru motorky: jede rovně, zatáčí před překážkou nebo náhodně, volí stranu s víc místa.
function chooseDir(g, w, fh, x, y, dir, rand) {
  const fwd = isFree(g, w, fh, x + DX[dir], y + DY[dir]);
  if (fwd && rand() >= TURN_PROB) return dir;
  const left = (dir + 3) & 3, right = (dir + 1) & 3;
  const l = room(g, w, fh, x, y, left, FLOOD_LIMIT);
  const r = room(g, w, fh, x, y, right, FLOOD_LIMIT);
  if (l === 0 && r === 0) return dir;
  const turn = l > r || (l === r && rand() < 0.5) ? left : right;
  const best = Math.max(l, r);
  // náhodná zatáčka nesmí vést do slepé uličky, když rovně je víc místa
  if (fwd && best < room(g, w, fh, x, y, dir, FLOOD_LIMIT)) return dir;
  return turn;
}

// Zvýší stáří výbuchu vybuchlých motorek (nejvýše 255).
function ageDead(g, base, n) {
  for (let b = 0; b < n; b++) {
    const o = base + b * 6;
    if (g[o + 3] === 0 && g[o + 4] < 255) g[o + 4]++;
  }
}

// GLSL výraz: bajt stavu na indexu k ve vyhrazených řádcích za hřištěm.
const mt = (k) => `int(texelFetch(uState, ivec2((${k}) % W, FH + (${k}) / W), 0).r * 255.0 + 0.5)`;

// Nové kolo: vyčistí hřiště (stěny zůstanou) a rozmístí motorky.
function startRound(g, w, fh, rand) {
  const field = w * fh;
  const base = field;
  let free = 0;
  for (let i = 0; i < field; i++) {
    if (g[i] !== WALL) {
      g[i] = 0;
      free++;
    }
  }
  const seed = [g[base + 28], g[base + 29], g[base + 30], g[base + 31]];
  g.fill(0, base, base + META);
  for (let k = 0; k < 4; k++) g[base + 28 + k] = seed[k];
  g[base + 27] = WALL;
  const want = free < 900 ? 2 : free < 2500 ? 3 : MAX_BIKES;
  let minDist = Math.max(3, Math.floor((w + fh) / (want + 1)));
  let n = 0;
  for (; n < want; n++) {
    let placed = false;
    for (let attempt = 0; attempt < 300 && !placed; attempt++) {
      if (attempt === 100 || attempt === 200) minDist = Math.floor(minDist / 2);
      const x = Math.floor(rand() * w), y = Math.floor(rand() * fh);
      if (g[y * w + x] !== 0) continue;
      let ok = true;
      for (let b = 0; b < n && ok; b++) {
        ok = Math.abs(g[base + b * 6] - x) + Math.abs(g[base + b * 6 + 1] - y) >= minDist;
      }
      if (!ok || flood(g, w, fh, x, y, 12) < 12) continue;
      let dir = 0, bestRoom = -1;
      for (let d = 0; d < 4; d++) {
        const rm = room(g, w, fh, x, y, d, FLOOD_LIMIT) + rand() * 0.5;
        if (rm > bestRoom) {
          bestRoom = rm;
          dir = d;
        }
      }
      g[base + n * 6] = x;
      g[base + n * 6 + 1] = y;
      g[base + n * 6 + 2] = dir;
      g[base + n * 6 + 3] = 1;
      g[y * w + x] = n + 1;
      placed = true;
    }
    if (!placed) break;
  }
  g[base + 24] = n;
}

export default {
  id: 'tron',
  name: 'Tron – světelné motorky',
  colors: 2,
  sim: {
    format: 'r8',
    // Čtvercové buňky; za hřiště se přidají řádky se stavem motorek.
    size(points, aspect) {
      const { w, h } = gridSize(points, aspect, CELLS_LONG);
      return { w, h: h + metaRows(w) };
    },
    stepsPerSecond: 12,
    stepsPerCycle: 3600,
    init(grid, w, h, seed, points, aspect) {
      const fh = h - metaRows(w);
      polygonMask(points, aspect, w, fh, grid);
      for (let i = 0; i < w * fh; i++) grid[i] = grid[i] ? 0 : WALL;
      const base = w * fh;
      for (let k = 0; k < 4; k++) grid[base + 28 + k] = (seed >>> (8 * k)) & 255;
      startRound(grid, w, fh, createRandom(seed));
    },
    step(src, dst, w, h, stepIndex) {
      dst.set(src);
      const fh = h - metaRows(w);
      const field = w * fh;
      const base = field;
      const n = dst[base + 24];
      const seed = (dst[base + 28] | (dst[base + 29] << 8) | (dst[base + 30] << 16) | (dst[base + 31] << 24)) >>> 0;
      const rand = createRandom((seed ^ Math.imul(stepIndex + 1, 0x85ebca6b)) >>> 0);

      // Doznívání výbuchů a mizení stop vybuchlých motorek (náhodně po buňkách).
      for (let i = 0; i < field; i++) {
        const v = dst[i];
        if (v >= EXPLOSION && v < WALL) {
          dst[i] = v === WALL - 1 ? 0 : v + 1;
        } else if (v >= 1 && v <= MAX_BIKES && v <= n && dst[base + (v - 1) * 6 + 3] === 0) {
          if ((Math.imul(i + 1, 0x9e3779b1) >>> 16) % FADE_STEPS < dst[base + (v - 1) * 6 + 4]) dst[i] = 0;
        }
      }
      if (n === 0) return;

      if (dst[base + 25] === 1) {
        // oslava vítěze, pak nové kolo
        if (++dst[base + 26] >= CELEBRATE_STEPS) startRound(dst, w, fh, rand);
        else ageDead(dst, base, n);
        return;
      }

      // Rozhodnutí o směru a cílové buňce každé živé motorky.
      const tx = [0, 0, 0, 0], ty = [0, 0, 0, 0], crash = [false, false, false, false];
      for (let b = 0; b < n; b++) {
        const o = base + b * 6;
        if (dst[o + 3] !== 1) continue;
        const dir = chooseDir(dst, w, fh, dst[o], dst[o + 1], dst[o + 2], rand);
        dst[o + 2] = dir;
        tx[b] = dst[o] + DX[dir];
        ty[b] = dst[o + 1] + DY[dir];
        crash[b] = !isFree(dst, w, fh, tx[b], ty[b]);
      }
      // Dvě motorky na stejné buňce se srazí obě.
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          if (dst[base + a * 6 + 3] === 1 && dst[base + b * 6 + 3] === 1 && tx[a] === tx[b] && ty[a] === ty[b]) {
            crash[a] = true;
            crash[b] = true;
          }
        }
      }
      let alive = 0, last = -1;
      for (let b = 0; b < n; b++) {
        const o = base + b * 6;
        if (dst[o + 3] !== 1) continue;
        if (crash[b]) {
          dst[o + 3] = 0;
          dst[o + 4] = 0;
          dst[dst[o + 1] * w + dst[o]] = EXPLOSION;
        } else {
          dst[o] = tx[b];
          dst[o + 1] = ty[b];
          dst[ty[b] * w + tx[b]] = b + 1;
          alive++;
          last = b;
        }
      }
      if (alive <= 1) {
        dst[base + 25] = 1;
        dst[base + 26] = 0;
        dst[base + 27] = alive === 1 ? last : WALL;
      }
      ageDead(dst, base, n);
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  const int META = ${META};
  int W = int(uStateSize.x);
  int FH = int(uStateSize.y) - (META + W - 1) / W;
  if (FH < 1) return vec3(0.0);
  vec2 g = vLocal * vec2(float(W), float(FH));
  ivec2 c = clamp(ivec2(floor(g)), ivec2(0), ivec2(W - 1, FH - 1));
  vec2 f = g - (vec2(c) + 0.5);
  vec3 pc[4] = vec3[4](uColA, uColB, mix(uColA, uColB, 0.5), mix(uColA, uColB, 0.5).brg);
  vec2 DV[4] = vec2[4](vec2(0.0, -1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(-1.0, 0.0));
  int nb = ${mt(24)};
  int phase = ${mt(25)};
  int win = ${mt(27)};
  float pulse = 1.0 + 0.5 * sin(t * 10.0);

  // Pozadí: tmavá plocha s jemnou neonovou mřížkou po 4 buňkách.
  vec2 gl4 = abs(fract(g * 0.25 - 0.5) - 0.5) * 4.0;
  float aa = max(fwidth(g.x), 0.01);
  float gridLine = 1.0 - smoothstep(0.0, 1.5 * aa, min(gl4.x, gl4.y));
  vec3 mid = mix(uColA, uColB, 0.5);
  vec3 col = mid * (0.03 + 0.07 * gridLine);

  // Stopy: jasné jádro spojené s obsazenými sousedy stejného hráče a měkká záře přes sousední buňky.
  int own = int(texelFetch(uState, c, 0).r * 255.0 + 0.5);
  float coreD = 1e3;
  vec3 glow = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 n = c + ivec2(dx, dy);
      if (n.x < 0 || n.y < 0 || n.x >= W || n.y >= FH) continue;
      int v = int(texelFetch(uState, n, 0).r * 255.0 + 0.5);
      if (v < 1 || v > 4) continue;
      float pm = (phase == 1 && win == v - 1) ? pulse : 1.0;
      vec2 d = f - vec2(float(dx), float(dy));
      glow += pc[v - 1] * pm * exp(-dot(d, d) * 5.0) * 0.45;
      if (dx == 0 && dy == 0) {
        coreD = min(coreD, length(f));
      } else if ((dx == 0 || dy == 0) && v == own) {
        vec2 e = 0.5 * vec2(float(dx), float(dy));
        coreD = min(coreD, length(f - e * clamp(dot(f, e) / dot(e, e), 0.0, 1.0)));
      }
    }
  }
  col += glow;
  if (own >= 1 && own <= 4) {
    float pm = (phase == 1 && win == own - 1) ? pulse : 1.0;
    col += mix(pc[own - 1], vec3(1.0), 0.65) * pm * (1.0 - smoothstep(0.08, 0.16, coreD));
  }

  // Hlavy motorek (plynule se posouvají mezi kroky) a výbuchy.
  for (int i = 0; i < 4; i++) {
    if (i >= nb) break;
    int bx = ${mt('i * 6')};
    int by = ${mt('i * 6 + 1')};
    int bd = ${mt('i * 6 + 2')};
    int ba = ${mt('i * 6 + 3')};
    int bage = ${mt('i * 6 + 4')};
    vec2 hc = vec2(float(bx), float(by)) + 0.5;
    vec2 dv = DV[bd & 3];
    if (ba == 1) {
      float slide = 0.0;
      if (phase == 0) {
        ivec2 tc = ivec2(bx, by) + ivec2(int(dv.x), int(dv.y));
        if (tc.x >= 0 && tc.y >= 0 && tc.x < W && tc.y < FH && int(texelFetch(uState, tc, 0).r * 255.0 + 0.5) == 0) slide = uStateFrac;
      }
      vec2 hp = hc + dv * slide;
      vec2 e = hp - hc;
      float td = length(g - hc - e * clamp(dot(g - hc, e) / max(dot(e, e), 1e-6), 0.0, 1.0));
      col += mix(pc[i], vec3(1.0), 0.65) * (1.0 - smoothstep(0.08, 0.16, td));
      float dh = length(g - hp);
      col += mix(pc[i], vec3(1.0), 0.85) * (1.0 - smoothstep(0.28, 0.42, dh)) * 1.2 + pc[i] * exp(-dh * dh * 2.5) * 0.7;
    } else if (bage < 6) {
      float a = float(bage) + uStateFrac;
      float k = 1.0 - a / 6.0;
      float d = length(g - hc);
      float ring = exp(-pow((d - 0.6 * a) / 0.45, 2.0));
      col += mix(pc[i], vec3(1.0), k) * k * (1.5 * exp(-d * d / (0.5 + 0.5 * a * a)) + 0.8 * ring);
    }
  }
  return col;`,
};
