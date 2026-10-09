// Zalévání barvou (kbelík z Malování), stavová animace (`sim`): barva se vylije z bodu, obtéká překážky a zaplní oblast, pak ji přelije další.
// Mřížka má o jeden řádek navíc (poslední): meta. Meta: [0] x a [1] y místa vylití, [2] číslo zalití G (0–5), [3] počítadlo pauzy.
// Hodnota buňky: 0 = nezalito, 1 = překážka, 255 = mimo oblast, 32 + g * 16 + čerstvost (0–15) = zalito g-tým zalitím.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const OBSTACLE = 1;
const OUTSIDE = 255;
const BASE = 32;
const FRESH = 15; // čerstvost právě zalité buňky, za krok klesá o 1
const POURS = 6; // nejvýše zalití v jednom cyklu (4–6)
const PAUSE_STEPS = 16; // pauza po zaplnění oblasti
const P_EDGE = 0.7; // pravděpodobnost, že se barva přelije do sousední buňky
const P_JUMP = 0.3; // pravděpodobnost přeskoku o dvě buňky v přímém směru
const OBSTACLES_MIN = 2;
const OBSTACLES_MAX = 4;

// Deterministické náhodné číslo [0, 1) z dvojice celých čísel.
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// Buňka (x, y) i s okolím o poloměru 2 leží uvnitř oblasti (překážky se nesmí dotknout okraje).
function deepInside(grid, w, gh, x, y) {
  if (x < 2 || y < 2 || x >= w - 2 || y >= gh - 2) return false;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) if (grid[(y + j) * w + x + i] === OUTSIDE) return false;
  }
  return true;
}

// Nakreslí úsečku z (x0, y0) do (x1, y1) jako překážku, jen v buňkách daleko od okraje oblasti.
function drawLine(grid, w, gh, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n);
    const y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (deepInside(grid, w, gh, x, y)) grid[y * w + x] = OBSTACLE;
  }
}

// Vybere buňku pro vylití: ze 6 náhodných kandidátů tu nejvzdálenější od předchozího místa (px, py).
function pickOrigin(grid, w, gh, seedA, seedB, px, py) {
  let best = -1;
  let bestD = -1;
  for (let k = 0; k < 40 && (k < 6 || best < 0); k++) {
    const x = Math.floor(hash2(seedA + k * 2, seedB) * w);
    const y = Math.floor(hash2(seedA + k * 2 + 1, seedB) * gh);
    const v = grid[y * w + x];
    if (v === OUTSIDE || v === OBSTACLE) continue;
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d > bestD) { bestD = d; best = y * w + x; }
  }
  if (best < 0) {
    for (let i = 0; i < w * gh; i++) if (grid[i] !== OUTSIDE && grid[i] !== OBSTACLE) { best = i; break; }
  }
  return best;
}

// Začne zalití g: zapíše buňku vylití a meta.
function startPour(grid, w, gh, g, seedA, seedB) {
  const meta = w * gh;
  const o = pickOrigin(grid, w, gh, seedA, seedB, grid[meta], grid[meta + 1]);
  if (o < 0) return; // oblast bez použitelné buňky
  grid[o] = BASE + g * 16 + FRESH;
  grid[meta] = o % w;
  grid[meta + 1] = Math.floor(o / w);
  grid[meta + 2] = g;
  grid[meta + 3] = 0;
}

export default {
  id: 'paintfill',
  name: 'Zalévání barvou',
  colors: 2,
  sim: {
    // Poslední řádek mřížky je meta, proto je mřížka o řádek vyšší než oblast.
    size(points, aspect) {
      const s = gridSize(points, aspect, CELLS_LONG);
      return { w: s.w, h: s.h + 1 };
    },
    stepsPerSecond: 30,
    stepsPerCycle: 3600,
    init(grid, w, h, seed, points, aspect) {
      const gh = h - 1;
      polygonMask(points, aspect, w, gh, grid);
      for (let i = 0; i < w * gh; i++) grid[i] = grid[i] ? 0 : OUTSIDE;
      const rand = createRandom(seed);
      const lines = OBSTACLES_MIN + Math.floor(rand() * (OBSTACLES_MAX - OBSTACLES_MIN + 1));
      for (let l = 0; l < lines; l++) {
        // lomená čára o 2–3 úsecích
        let x = rand() * w;
        let y = rand() * gh;
        const segs = 2 + Math.floor(rand() * 2);
        for (let s = 0; s < segs; s++) {
          const ang = rand() * Math.PI * 2;
          const len = (0.1 + rand() * 0.2) * Math.max(w, gh);
          const nx = x + Math.cos(ang) * len;
          const ny = y + Math.sin(ang) * len;
          drawLine(grid, w, gh, Math.round(x), Math.round(y), Math.round(nx), Math.round(ny));
          x = nx;
          y = ny;
        }
      }
      grid[w * gh] = 0;
      grid[w * gh + 1] = 0;
      startPour(grid, w, gh, 0, seed >>> 0, 1);
    },
    step(src, dst, w, h, stepIndex) {
      const gh = h - 1;
      const meta = w * gh;
      dst.set(src);
      const G = src[meta + 2];
      const cur = BASE + G * 16; // dolní mez hodnot aktuálního zalití
      let pending = 0;
      let fresh = 0;
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = src[i];
          if (v === OUTSIDE || v === OBSTACLE) continue;
          if (v >= BASE) {
            if ((v & 15) > 0) { dst[i] = v - 1; fresh++; }
            if (v >= cur && v < cur + 16) continue; // už je zalito aktuální barvou
          }
          const l = x > 0 ? src[i - 1] : 0;
          const r = x < w - 1 ? src[i + 1] : 0;
          const u = y > 0 ? src[i - w] : 0;
          const d = y < gh - 1 ? src[i + w] : 0;
          const near = (l >= cur && l < cur + 16) || (r >= cur && r < cur + 16)
            || (u >= cur && u < cur + 16) || (d >= cur && d < cur + 16);
          let grow = false;
          if (near) {
            pending++;
            grow = hash2(i, stepIndex) < P_EDGE;
          } else if (hash2(i + 0x10000, stepIndex) < P_JUMP) {
            // přeskok o dvě buňky v přímém směru přes volnou (nebo jinou) buňku, která není překážka
            const l2 = x > 1 && l !== OBSTACLE && l !== OUTSIDE ? src[i - 2] : 0;
            const r2 = x < w - 2 && r !== OBSTACLE && r !== OUTSIDE ? src[i + 2] : 0;
            const u2 = y > 1 && u !== OBSTACLE && u !== OUTSIDE ? src[i - 2 * w] : 0;
            const d2 = y < gh - 2 && d !== OBSTACLE && d !== OUTSIDE ? src[i + 2 * w] : 0;
            grow = (l2 >= cur && l2 < cur + 16) || (r2 >= cur && r2 < cur + 16)
              || (u2 >= cur && u2 < cur + 16) || (d2 >= cur && d2 < cur + 16);
          }
          if (grow) { dst[i] = cur + FRESH; fresh++; }
        }
      }
      if (pending > 0) return;
      // Oblast je zaplněná: pauza, než zmizí čerstvost, pak další zalití.
      if (src[meta + 3] < PAUSE_STEPS) { dst[meta + 3] = src[meta + 3] + 1; return; }
      if (fresh > 0 && src[meta + 3] < PAUSE_STEPS + FRESH) { dst[meta + 3] = src[meta + 3] + 1; return; }
      const wrap = G + 1 >= POURS || (G >= 3 && hash2(stepIndex, 77) < 0.5);
      if (wrap) {
        for (let i = 0; i < w * gh; i++) if (dst[i] >= BASE && dst[i] < OUTSIDE) dst[i] = 0;
      }
      startPour(dst, w, gh, wrap ? 0 : G + 1, stepIndex * 3 + 5, 2);
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  vec2 gs = vec2(uStateSize.x, uStateSize.y - 1.0);
  vec2 g = vLocal * gs;
  ivec2 c = ivec2(clamp(floor(g), vec2(0.0), gs - 1.0));
  float v = floor(texelFetch(uState, c, 0).r * 255.0 + 0.5);
  if (v > 254.5) return vec3(0.0);
  vec2 f = fract(g);
  // viditelné pixely: mezera mezi buňkami lehce ztmaví barvu
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float px = mix(0.78, 1.0, smoothstep(0.02, 0.1, edge));
  vec3 col = vec3(0.0); // nezalito
  if (v > 0.5 && v < 31.5) col = vec3(0.6) * px; // překážka (tenká čára)
  if (v >= 31.5) {
    float gen = floor(v / 16.0) - 2.0;
    float fresh = v - 32.0 - gen * 16.0;
    float order[6] = float[6](0.0, 1.0, 0.4, 0.8, 0.2, 0.6);
    col = mix(uColA, uColB, order[int(clamp(gen, 0.0, 5.0))]);
    // světlejší okraj na frontě
    col = mix(col, vec3(1.0), 0.55 * clamp((fresh - 11.0) / 4.0, 0.0, 1.0)) * px;
  }
  // pixelová ikona kbelíku (7 × 8 buněk) nad místem vylití, jen krátce po začátku zalití
  vec4 m0 = texelFetch(uState, ivec2(0, int(gs.y)), 0);
  float ox = floor(m0.r * 255.0 + 0.5);
  float oy = floor(m0.g * 255.0 + 0.5);
  vec2 rel = floor(g) - vec2(ox - 3.0, oy - 9.0);
  float og = floor(texelFetch(uState, ivec2(int(ox), int(oy)), 0).r * 255.0 + 0.5);
  float ofresh = og >= 32.0 && og < 255.0 ? og - 32.0 - (floor(og / 16.0) - 2.0) * 16.0 : 0.0;
  if (ofresh > 5.0 && rel.x >= 0.0 && rel.x < 7.0 && rel.y >= 0.0 && rel.y < 8.0) {
    // řádky shora dolů, bit 6 = levý sloupec: 1 = obrys kbelíku, 2 = barva (kapka)
    int row = int(rel.y);
    int bits = row == 0 ? 0x1C : row == 1 ? 0x22 : row == 2 ? 0x41 : row == 3 ? 0x7F
      : row == 4 ? 0x7F : row == 5 ? 0x7F : row == 6 ? 0x3E : 0x1C;
    int bit = 6 - int(rel.x);
    if (((bits >> bit) & 1) == 1) {
      bool body = row >= 3;
      return body ? vec3(0.9) : vec3(1.0);
    }
  }
  return col;`,
};
