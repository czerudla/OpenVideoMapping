// 2048 hraje samo – stavová animace (`sim`, rgba8). Dlaždice se posouvají a slučují podle pravidel hry, tahy volí
// heuristika s výhledem o dva tahy. Po konci hry pole ztmavne, krátce počká a začne nová hra.
// Buňka (x, y): R = log2 hodnoty (0 = prázdná), G = směr tahu (bity 3–4) a vzdálenost, odkud dlaždice přijela (bity 0–2),
// B = vzdálenost druhé dlaždice při sloučení (0 = bez sloučení), A = 255 pro novou dlaždici.
// Poslední řádek mřížky je meta: texel 0 R = kroky od konce hry (0 = hra běží), texel 1 = seed (4 bajty).
import { createRandom, gridSize } from '../sim-utils.js';

const MAX_EXP = 16; // nejvyšší dlaždice 65536 (5 číslic)
const DEAD_STEPS = 9; // kroků od konce hry do nové hry
const MAX_CELLS = 36;
const SEED_MUL = 0x9e3779b1;

// Pixelové glyfy 3×5, řádky shora, v každém řádku 3 bity (nejvyšší bit vlevo).
const DIGIT_ROWS = [
  [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
];
const GLYPHS = DIGIT_ROWS.map((rows) => rows.reduce((acc, r) => (acc << 3) | r, 0));

// Dočasná paměť jednoho volání step (žádný trvalý stav hry zde není).
const cur = new Uint8Array(MAX_CELLS);
const tmp1 = Array.from({ length: 4 }, () => new Uint8Array(MAX_CELLS));
const tmp2 = new Uint8Array(MAX_CELLS);
const probe = new Uint8Array(MAX_CELLS);
const POW4 = Array.from({ length: MAX_EXP + 2 }, (_, v) => v ** 4);
const POW35 = Array.from({ length: MAX_EXP + 2 }, (_, v) => v ** 3.5);

// Poměr stran oblasti určuje pole: 4×4, 6×4 nebo 5×3 (u podlouhlých oblastí, na výšku otočené).
function boardSize(points, aspect) {
  const g = gridSize(points, aspect, 64);
  const r = g.w / g.h;
  const long = Math.max(r, 1 / r);
  const [a, b] = long < 1.25 ? [4, 4] : long < 1.58 ? [6, 4] : [5, 3];
  return r >= 1 ? { w: a, h: b } : { w: b, h: a };
}

// Index buňky na řádku/sloupci `line` ve vzdálenosti k od zdi, ke které se táhne.
function cellIndex(dir, line, k, w, h) {
  return dir === 0 ? line * w + k : dir === 1 ? line * w + (w - 1 - k) : dir === 2 ? k * w + line : (h - 1 - k) * w + line;
}

// Posune desku `src` ve směru dir (0 vlevo, 1 vpravo, 2 nahoru, 3 dolů) do `dst`. Při zadaném `out` (rgba pole)
// zapíše i informace pro animaci. Vrací true, pokud se deska změnila.
function slide(src, dst, w, h, dir, out) {
  const lines = dir < 2 ? h : w;
  const len = dir < 2 ? w : h;
  let changed = false;
  dst.fill(0, 0, w * h);
  for (let line = 0; line < lines; line++) {
    let dk = -1; // cílový index poslední dlaždice
    let lastFrom = 0;
    let merged = false;
    for (let k = 0; k < len; k++) {
      const v = src[cellIndex(dir, line, k, w, h)];
      if (v === 0) continue;
      if (dk >= 0 && !merged && dst[cellIndex(dir, line, dk, w, h)] === v && v < MAX_EXP) {
        const o = cellIndex(dir, line, dk, w, h);
        dst[o] = v + 1;
        merged = true;
        changed = true;
        if (out) {
          out[o * 4] = v + 1;
          out[o * 4 + 2] = k - dk;
        }
      } else {
        dk++;
        merged = false;
        lastFrom = k;
        const o = cellIndex(dir, line, dk, w, h);
        dst[o] = v;
        if (k !== dk) changed = true;
        if (out) {
          out[o * 4] = v;
          out[o * 4 + 1] = (dir << 3) | (lastFrom - dk);
        }
      }
    }
  }
  return changed;
}

// Ohodnocení desky: prázdná místa, sloučitelné dvojice, monotónnost řádků a sloupců, součet hodnot a velká dlaždice v rohu.
function evaluate(b, w, h) {
  let empty = 0, merges = 0, sum = 0, max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = b[y * w + x];
      if (v === 0) { empty++; continue; }
      sum += POW35[v];
      if (v > max) max = v;
      if (x + 1 < w && b[y * w + x + 1] === v) merges++;
      if (y + 1 < h && b[(y + 1) * w + x] === v) merges++;
    }
  }
  let mono = 0;
  for (let y = 0; y < h; y++) {
    let l = 0, r = 0;
    for (let x = 0; x + 1 < w; x++) {
      const a = POW4[b[y * w + x]], c = POW4[b[y * w + x + 1]];
      if (a > c) l += a - c; else r += c - a;
    }
    mono += Math.min(l, r);
  }
  for (let x = 0; x < w; x++) {
    let l = 0, r = 0;
    for (let y = 0; y + 1 < h; y++) {
      const a = POW4[b[y * w + x]], c = POW4[b[(y + 1) * w + x]];
      if (a > c) l += a - c; else r += c - a;
    }
    mono += Math.min(l, r);
  }
  const corner = b[0] === max || b[w - 1] === max || b[(h - 1) * w] === max || b[h * w - 1] === max ? 1 : 0;
  return 200000 + empty * 270 + merges * 700 + corner * 2000 - mono * 47 - sum * 11;
}

// Vybere tah: ohodnocení desky po tahu plus polovina nejlepšího následujícího tahu. Vrací -1, pokud nelze táhnout.
function chooseMove(board, w, h) {
  let best = -1;
  let bestScore = -Infinity;
  for (let d = 0; d < 4; d++) {
    if (!slide(board, tmp1[d], w, h, d)) continue;
    let score = evaluate(tmp1[d], w, h);
    let next = -Infinity;
    for (let d2 = 0; d2 < 4; d2++) {
      if (slide(tmp1[d], tmp2, w, h, d2)) next = Math.max(next, evaluate(tmp2, w, h));
    }
    score += next === -Infinity ? -100000 : 0.5 * next;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// Přidá novou dlaždici (2 s 90 %, jinak 4) na náhodné volné místo.
function spawn(grid, n, rand) {
  let free = 0;
  for (let i = 0; i < n; i++) if (grid[i * 4] === 0) free++;
  if (free === 0) return;
  let pick = Math.floor(rand() * free);
  const val = rand() < 0.9 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    if (grid[i * 4] !== 0) continue;
    if (pick-- === 0) {
      grid[i * 4] = val;
      grid[i * 4 + 3] = 255;
      return;
    }
  }
}

function writeSeed(grid, offset, seed) {
  grid[offset] = seed & 255;
  grid[offset + 1] = (seed >>> 8) & 255;
  grid[offset + 2] = (seed >>> 16) & 255;
  grid[offset + 3] = (seed >>> 24) & 255;
}

function readSeed(grid, offset) {
  return (grid[offset] | (grid[offset + 1] << 8) | (grid[offset + 2] << 16) | (grid[offset + 3] << 24)) >>> 0;
}

// Nová hra: prázdná deska se dvěma dlaždicemi, seed se uloží do meta řádku.
function startGame(grid, w, h, seed) {
  const n = w * (h - 1);
  grid.fill(0, 0, w * h * 4);
  const rand = createRandom(seed);
  spawn(grid, n, rand);
  spawn(grid, n, rand);
  writeSeed(grid, n * 4 + 4, seed);
}

export default {
  id: '2048',
  name: '2048',
  colors: 2,
  sim: {
    // Pole + jeden řádek navíc pro meta údaje.
    size(points, aspect) {
      const b = boardSize(points, aspect);
      return { w: b.w, h: b.h + 1 };
    },
    format: 'rgba8',
    stepsPerSecond: 3,
    stepsPerCycle: 4000,
    init(grid, w, h, seed) {
      startGame(grid, w, h, seed);
    },
    step(src, dst, w, h, stepIndex) {
      const rows = h - 1;
      const n = w * rows;
      const meta = n * 4;
      const dead = src[meta];
      const seed = readSeed(src, meta + 4);
      dst.fill(0, 0, w * h * 4);
      if (dead > 0) {
        // Konec hry: deska stojí, ztmavuje, pak začne nová hra.
        if (dead + 1 >= DEAD_STEPS) {
          startGame(dst, w, h, (Math.imul(seed ^ (stepIndex + 1), 0x85ebca6b) + SEED_MUL) >>> 0);
        } else {
          for (let i = 0; i < n; i++) dst[i * 4] = src[i * 4];
          dst[meta] = dead + 1;
          writeSeed(dst, meta + 4, seed);
        }
        return;
      }
      for (let i = 0; i < n; i++) cur[i] = src[i * 4];
      const dir = chooseMove(cur, w, rows);
      if (dir < 0) {
        for (let i = 0; i < n; i++) dst[i * 4] = cur[i];
        dst[meta] = 1;
        writeSeed(dst, meta + 4, seed);
        return;
      }
      slide(cur, tmp2, w, rows, dir, dst);
      spawn(dst, n, createRandom((seed ^ Math.imul(stepIndex + 1, SEED_MUL)) >>> 0));
      writeSeed(dst, meta + 4, seed);
      // Po spawnu zkontroluj, zda lze ještě táhnout.
      for (let i = 0; i < n; i++) probe[i] = dst[i * 4];
      let alive = false;
      for (let d = 0; d < 4 && !alive; d++) alive = slide(probe, tmp2, w, rows, d);
      if (!alive) dst[meta] = 1;
    },
  },
  glsl: `const float GAP = 0.06;
  const float RAD = 0.12;
  const int GLYPH[10] = int[10](${GLYPHS.join(', ')});
  vec2 lo = vec2(1e9);
  vec2 hi = vec2(-1e9);
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    vec2 a = polyV(i);
    lo = min(lo, a);
    hi = max(hi, a);
  }
  if (uStateSize.x < 1.0 || uStateSize.y < 2.0) return vec3(0.0);
  vec2 bs = max(hi - lo, vec2(1e-4));
  vec2 B = vec2(uStateSize.x, uStateSize.y - 1.0);
  float cell = min(bs.x / B.x, bs.y / B.y);
  vec2 pb = (vLocal * bs - 0.5 * (bs - B * cell)) / cell;
  float aa = max(fwidth(pb.x), 1e-4);

  // Hrací pole se zaoblenými rohy, mimo něj je černá.
  vec2 bq = abs(pb - 0.5 * B) - (0.5 * B - 0.15);
  float board = 1.0 - smoothstep(-aa, aa, length(max(bq, 0.0)) - 0.15);
  if (board <= 0.0) return vec3(0.0);
  vec3 col = vec3(0.09);
  vec2 sq = abs(fract(pb) - 0.5) - (0.5 - GAP - RAD);
  col = mix(col, vec3(0.16), 1.0 - smoothstep(-aa, aa, length(max(sq, 0.0)) - RAD));

  float p = clamp(uStateFrac / 0.6, 0.0, 1.0);
  float m = 1.0 - pow(1.0 - p, 3.0);
  for (int j = 0; j < 6; j++) {
    if (float(j) >= B.y) break;
    for (int i = 0; i < 6; i++) {
      if (float(i) >= B.x) break;
      vec4 s = floor(texelFetch(uState, ivec2(i, j), 0) * 255.0 + 0.5);
      int e = int(s.r);
      if (e == 0) continue;
      int g = int(s.g);
      int dir = g / 8;
      float d1 = float(g - dir * 8);
      vec2 from = dir == 0 ? vec2(1.0, 0.0) : dir == 1 ? vec2(-1.0, 0.0) : dir == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
      bool merged = s.b > 0.5;
      bool isNew = s.a > 127.0;
      vec2 dest = vec2(float(i), float(j)) + 0.5;
      for (int k = 0; k < 2; k++) {
        if (k == 1 && !(merged && p < 1.0)) break;
        float sc = 1.0;
        int ev = e;
        if (isNew) sc = smoothstep(0.5, 1.0, uStateFrac);
        else if (merged && p < 1.0) ev = e - 1;
        else if (merged) sc = 1.0 + 0.16 * sin(3.14159 * clamp((uStateFrac - 0.6) / 0.4, 0.0, 1.0));
        if (sc < 0.02) continue;
        vec2 c = dest + from * (k == 0 ? d1 : s.b) * (1.0 - m);
        vec2 u = (pb - c) / sc;
        float d = length(max(abs(u) - (0.5 - GAP - RAD), 0.0)) - RAD;
        float fill = 1.0 - smoothstep(-aa / sc, aa / sc, d);
        if (fill <= 0.0) continue;
        vec3 tc = mix(uColB, uColA, clamp((float(ev) - 1.0) / 10.0, 0.0, 1.0));
        vec3 fg = dot(tc, vec3(0.299, 0.587, 0.114)) > 0.5 ? vec3(0.05) : vec3(0.97);

        // Číslo z pixelových glyfů, rozměr se přizpůsobí počtu číslic.
        int val = 1 << ev;
        int nd = val < 10 ? 1 : val < 100 ? 2 : val < 1000 ? 3 : val < 10000 ? 4 : 5;
        float px = min(0.12, 0.78 / (4.0 * float(nd) - 1.0));
        float py = min(px * 1.5, 0.13);
        float tx = (u.x + 0.5 * (4.0 * float(nd) - 1.0) * px) / px;
        float ty = (u.y + 2.5 * py) / py;
        float txt = 0.0;
        if (tx >= 0.0 && tx < 4.0 * float(nd) - 1.0 && ty >= 0.0 && ty < 5.0) {
          int di = int(tx / 4.0);
          float wx = tx - float(di) * 4.0;
          if (wx < 3.0) {
            int pw = 1;
            for (int q = 0; q < 5; q++) {
              if (q >= nd - 1 - di) break;
              pw *= 10;
            }
            int bit = (GLYPH[(val / pw) % 10] >> ((4 - int(ty)) * 3 + (2 - int(wx)))) & 1;
            txt = float(bit);
          }
        }
        col = mix(col, mix(tc, fg, txt), fill);
      }
    }
  }

  // Konec hry: deska postupně ztmavne.
  int dead = int(texelFetch(uState, ivec2(0, int(B.y)), 0).r * 255.0 + 0.5);
  if (dead >= 2) col *= 1.0 - 0.8 * smoothstep(0.0, 2.5, float(dead - 2) + uStateFrac);
  return col * board;`,
};
