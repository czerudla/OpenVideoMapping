// Bludiště: ve tvaru oblasti se vykope bludiště (rekurzivní backtracking), od vstupu se rozlije vlna hledání (BFS),
// po dosažení východu se rozsvítí nejkratší cesta a bludiště se rozplyne. Pak začne nové. Stavová animace (`sim`).
// Veškerý stav je v poli (rgba8), nic se neukládá do proměnných modulu:
//   R = typ buňky (0 mimo/ostrov, 1 stěna, 2 chodba, 3+ rozplývání: R-3 = počet kroků),
//   G = směr k rodiči (0 nahoru, 1 doprava, 2 dolů, 3 doleva, 4 = vstup, kořen stromu),
//   B = vzdálenost od vstupu (spodních 8 bitů), před hledáním náhodný bajt pro generátor,
//   A = příznaky (viz F_*) a horní 2 bity vzdálenosti (bity 4–5).
// Hlava kopání i fronta BFS se poznají z příznaků v buňkách, cesta vede zpět po směrech k rodiči.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 41; // buněk na delší straně (lichý počet: místnosti a stěny se střídají)
const T_VOID = 0;
const T_WALL = 1;
const T_PASS = 2;
const T_FADE = 3;
const ROOT = 4;
const F_HEAD = 1; // hlava kopání
const F_SEEN = 2; // vlna hledání už buňkou prošla
const F_PATH = 4; // buňka je na nejkratší cestě
const F_FRONT = 8; // čelo vlny
const F_TIP = 64; // špička rozsvěcované cesty
const F_EXIT = 128; // východ
const DIST_BITS = 0x30;
const MAX_DIST = 1023;
const HOLD_STEPS = 24; // jak dlouho svítí hotová cesta
const FADE_STEPS = 24; // rozplývání
const PATH_PER_STEP = 2;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

function hash32(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

function getDist(grid, i) {
  return grid[i * 4 + 2] | (((grid[i * 4 + 3] >> 4) & 3) << 8);
}

function setDist(grid, i, d) {
  const v = Math.min(d, MAX_DIST);
  grid[i * 4 + 2] = v & 255;
  grid[i * 4 + 3] = (grid[i * 4 + 3] & ~DIST_BITS) | ((v >> 8) << 4);
}

// Jeden krok kopání: 1–3 tahy, každý buď vykope spojku a místnost, nebo se vrátí o místnost zpět.
function dig(dst, w, head, stepIndex) {
  let h = head;
  const moves = 1 + (hash32(stepIndex, h, dst[h * 4 + 2]) % 3);
  for (let m = 0; m < moves; m++) {
    const x = h % w;
    const y = (h - x) / w;
    const rows = dst.length / 4 / w;
    const cand = [];
    for (let d = 0; d < 4; d++) {
      const rx = x + 2 * DX[d];
      const ry = y + 2 * DY[d];
      if (rx < 0 || ry < 0 || rx >= w || ry >= rows) continue;
      const room = ry * w + rx;
      const conn = (y + DY[d]) * w + x + DX[d];
      if (dst[room * 4] === T_WALL && dst[conn * 4] === T_WALL) cand.push(d);
    }
    dst[h * 4 + 3] &= ~F_HEAD;
    if (cand.length) {
      const d = cand[hash32(stepIndex, h * 4 + m, dst[h * 4 + 2]) % cand.length];
      const conn = (y + DY[d]) * w + x + DX[d];
      const room = (y + 2 * DY[d]) * w + x + 2 * DX[d];
      dst[conn * 4] = T_PASS;
      dst[conn * 4 + 1] = (d + 2) % 4;
      dst[room * 4] = T_PASS;
      dst[room * 4 + 1] = (d + 2) % 4;
      h = room;
    } else {
      const g = dst[h * 4 + 1];
      if (g === ROOT) return;
      h += 2 * (DY[g] * w + DX[g]);
    }
    dst[h * 4 + 3] |= F_HEAD;
  }
}

// Všechny chodby začnou mizet (T_FADE), počítá se od nuly.
function startFade(dst) {
  for (let o = 0; o < dst.length; o += 4) {
    if (dst[o] === T_PASS) dst[o] = T_FADE;
    dst[o + 3] &= ~(F_TIP | F_FRONT);
  }
}

// Nové bludiště v téže mřížce: seed vychází z podoby předchozího (deterministicky).
function restart(dst, stepIndex) {
  let seed = stepIndex + 1;
  for (let o = 1; o < dst.length; o += 4) seed = Math.imul(seed ^ dst[o], 0x01000193) >>> 0;
  const rand = createRandom(seed);
  for (let o = 0; o < dst.length; o += 4) {
    if (dst[o] >= T_PASS) dst[o] = T_WALL;
    if (dst[o + 1] !== ROOT) dst[o + 1] = 0;
    dst[o + 2] = Math.floor(rand() * 256);
    dst[o + 3] &= F_EXIT;
  }
  for (let o = 0; o < dst.length; o += 4) {
    if (dst[o + 1] === ROOT) {
      dst[o] = T_PASS;
      dst[o + 3] |= F_HEAD;
    }
  }
}

export default {
  id: 'maze',
  group: 'games',
  name: 'Bludiště',
  colors: 2,
  sim: {
    // Lichý rozměr mřížky: místnosti na lichých souřadnicích, mezi nimi stěny.
    size(points, aspect) {
      const { w, h } = gridSize(points, aspect, CELLS_LONG);
      return { w: w | 1, h: h | 1 };
    },
    stepsPerSecond: 40,
    stepsPerCycle: 6000,
    format: 'rgba8',
    init(grid, w, h, seed, points, aspect) {
      if (w < 3 || h < 3) return;
      const mask = polygonMask(points, aspect, w, h);
      const rand = createRandom(seed);
      for (let i = 0; i < w * h; i++) grid[i * 4 + 2] = Math.floor(rand() * 256);
      // Vstup: místnost v masce nejvíc vlevo nahoře.
      let entry = -1;
      let best = Infinity;
      for (let y = 1; y < h; y += 2) {
        for (let x = 1; x < w; x += 2) {
          if (mask[y * w + x] && x + y < best) {
            best = x + y;
            entry = y * w + x;
          }
        }
      }
      if (entry < 0) return;
      // Souvislá část s místnostmi dosažitelnými ze vstupu; ostrůvky se vynechají.
      const comp = new Uint8Array(w * h);
      const stack = new Int32Array(w * h);
      let sp = 0;
      stack[sp++] = entry;
      comp[entry] = 1;
      let exit = entry;
      let far = best;
      while (sp) {
        const i = stack[--sp];
        const x = i % w;
        const y = (i - x) / w;
        if (x + y >= far) {
          far = x + y;
          exit = i;
        }
        for (let d = 0; d < 4; d++) {
          const rx = x + 2 * DX[d];
          const ry = y + 2 * DY[d];
          if (rx < 1 || ry < 1 || rx >= w || ry >= h) continue;
          const j = ry * w + rx;
          if (!comp[j] && mask[j] && mask[(y + DY[d]) * w + x + DX[d]]) {
            comp[j] = 1;
            stack[sp++] = j;
          }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (x % 2 === 1 && y % 2 === 1) {
            grid[i * 4] = comp[i] ? T_WALL : T_VOID;
            continue;
          }
          // Stěna jen tam, kde sousedí s místností bludiště.
          let near = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < w && ny < h && comp[ny * w + nx]) near = true;
            }
          }
          grid[i * 4] = mask[i] && near ? T_WALL : T_VOID;
        }
      }
      grid[entry * 4] = T_PASS;
      grid[entry * 4 + 1] = ROOT;
      grid[entry * 4 + 3] |= F_HEAD;
      grid[exit * 4 + 3] |= F_EXIT;
    },
    step(src, dst, w, h, stepIndex) {
      dst.set(src);
      const n = w * h;
      let head = -1;
      let entry = -1;
      let exit = -1;
      let tip = -1;
      let front = 0;
      let fadeT = -1;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const a = src[o + 3];
        if (src[o + 1] === ROOT) entry = i;
        if (a & F_EXIT) exit = i;
        if (a & F_HEAD) head = i;
        if (a & F_TIP) tip = i;
        if (a & F_FRONT) front++;
        if (src[o] >= T_FADE) fadeT = src[o] - T_FADE;
      }
      if (entry < 0) return;

      // 4. Rozplývání a nové bludiště.
      if (fadeT >= 0) {
        if (fadeT + 1 >= HOLD_STEPS + FADE_STEPS) {
          restart(dst, stepIndex);
        } else {
          for (let o = 0; o < dst.length; o += 4) if (dst[o] >= T_FADE) dst[o]++;
        }
        return;
      }
      // 1. Generování.
      if (head >= 0) {
        dig(dst, w, head, stepIndex);
        return;
      }
      // 3. Rozsvěcení nejkratší cesty od východu ke vstupu po směrech k rodiči.
      if (tip >= 0) {
        let cur = tip;
        for (let k = 0; k < PATH_PER_STEP; k++) {
          const g = dst[cur * 4 + 1];
          dst[cur * 4 + 3] &= ~F_TIP;
          if (g === ROOT) {
            startFade(dst);
            return;
          }
          cur += DY[g] * w + DX[g];
          dst[cur * 4 + 3] |= F_TIP | F_PATH;
        }
        return;
      }
      // 2. Hledání: BFS po vrstvách, fronta je odvozená z buněk s příznakem čela vlny.
      if (!(src[entry * 4 + 3] & F_SEEN)) {
        dst[entry * 4 + 3] |= F_SEEN | F_FRONT;
        setDist(dst, entry, 0);
      } else if (front === 0) {
        startFade(dst);
        return;
      } else {
        for (let i = 0; i < n; i++) {
          if (!(src[i * 4 + 3] & F_FRONT)) continue;
          dst[i * 4 + 3] &= ~F_FRONT;
          const d = getDist(src, i);
          const x = i % w;
          const y = (i - x) / w;
          for (let k = 0; k < 4; k++) {
            const nx = x + DX[k];
            const ny = y + DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (src[j * 4] !== T_PASS || (dst[j * 4 + 3] & F_SEEN)) continue;
            dst[j * 4 + 3] |= F_SEEN | F_FRONT;
            setDist(dst, j, d + 1);
          }
        }
      }
      if (exit >= 0 && (dst[exit * 4 + 3] & F_SEEN)) {
        for (let o = 0; o < dst.length; o += 4) dst[o + 3] &= ~F_FRONT;
        dst[exit * 4 + 3] |= F_TIP | F_PATH;
      }
    },
  },
  glsl: `const float HOLD = ${HOLD_STEPS}.0;
  const float FADEN = ${FADE_STEPS}.0;
  if (uStateSize.x < 1.0) return vec3(0.0);
  vec2 g = vLocal * uStateSize;
  ivec2 sz = ivec2(uStateSize);
  ivec2 c = clamp(ivec2(floor(g)), ivec2(0), sz - 1);
  vec2 f = fract(g) - 0.5;
  vec4 s = texelFetch(uState, c, 0);
  int type = int(s.r * 255.0 + 0.5);
  if (type == 0) return vec3(0.0);
  int fl = int(s.a * 255.0 + 0.5);
  float dist = float(int(s.b * 255.0 + 0.5) + ((fl >> 4) & 3) * 256);
  float fade = 0.0;
  if (type >= 3) fade = clamp((float(type - 3) - HOLD) / FADEN, 0.0, 1.0);
  float keep = step(fade, hash(vec2(c) * 0.37 + 1.3));
  vec3 wall = (uColA + uColB) * 0.035;
  if (type == 1) {
    // Stěna je tmavá, u chodeb se jemně rozsvítí.
    vec3 glow = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      ivec2 d = k == 0 ? ivec2(0, -1) : (k == 1 ? ivec2(1, 0) : (k == 2 ? ivec2(0, 1) : ivec2(-1, 0)));
      ivec2 nb = c + d;
      if (nb.x < 0 || nb.y < 0 || nb.x >= sz.x || nb.y >= sz.y) continue;
      vec4 ns = texelFetch(uState, nb, 0);
      int nt = int(ns.r * 255.0 + 0.5);
      if (nt < 2) continue;
      float nf = nt >= 3 ? 1.0 - clamp((float(nt - 3) - HOLD) / FADEN, 0.0, 1.0) : 1.0;
      float edge = clamp(0.5 - dot(f, vec2(d)), 0.0, 1.0);
      float k1 = 1.0 - smoothstep(0.0, 0.9, edge);
      bool seen = ((int(ns.a * 255.0 + 0.5) >> 1) & 1) == 1;
      glow += (seen ? uColB : uColA) * (0.4 * k1 * k1 * nf);
    }
    return wall + glow;
  }
  bool head = (fl & 1) != 0;
  bool seen = (fl & 2) != 0;
  bool path = (fl & 4) != 0;
  bool front = (fl & 8) != 0;
  bool tip = (fl & 64) != 0;
  vec3 col = uColA * 0.7;
  if (seen) col = uColB * (0.4 + 0.3 * (0.5 + 0.5 * cos(dist * 0.12)));
  if (front) col = mix(uColB, vec3(1.0), 0.6);
  if (path) col = mix(uColA, vec3(1.0), 0.2 + 0.2 * sin(t * 8.0));
  if (head || tip) col = mix(uColA, vec3(1.0), 0.75);
  col *= 0.88 + 0.12 * (1.0 - 2.0 * max(abs(f.x), abs(f.y)));
  return mix(wall, col, (1.0 - fade) * keep);`,
};
