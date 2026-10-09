// Lesní požár – Drossel–Schwablův buněčný automat, stavová animace (`sim`, r8).
// Hodnota buňky: 0 = mimo oblast, 1 = prázdná půda, 2–9 = popel (9 čerstvý), 16–111 = strom (hodnota − 16 je věk),
// 200–240 = hoření (240 žhavé jádro, klesá po 8 do 200), 255 = úder blesku (hoří jako 240).
// Náhoda v kroku je hash z (buňka, krok), takže simulace je deterministická a nepotřebuje žádný stav mimo mřížku.
import { gridSize, polygonMask, createRandom } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const EMPTY = 1;
const ASH_MAX = 9;
const TREE_MIN = 16;
const TREE_MAX = 111;
const BURN_MIN = 200;
const BURN_HOT = 224; // od této hodnoty hořící buňka zapaluje sousedy
const BURN_START = 240;
const LIGHTNING = 255;
const GROW = 0.012; // p: pravděpodobnost, že prázdná buňka obroste
const STRIKE = 0.02; // pravděpodobnost úderu blesku za krok (celá oblast), f na buňku je řádově 1e-6
const SPREAD_ORTHO = 0.6; // šance zapálení stromu od jednoho žhavého souseda za krok (4-okolí)
const SPREAD_DIAG = 0.25; // totéž pro úhlopříčné sousedy
const ASH_DECAY = 0.15; // šance, že popel o stupeň zesvětlá/zmizí
const INIT_DENSITY = 0.6;

// Celočíselný hash (buňka, krok, sůl) → [0, 1).
function rnd(i, step, salt) {
  let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const isTree = (v) => v >= TREE_MIN && v <= TREE_MAX;

export default {
  id: 'forestfire',
  name: 'Lesní požár',
  colors: 2,
  sim: {
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 14,
    stepsPerCycle: 8400,
    init(grid, w, h, seed, points, aspect) {
      polygonMask(points, aspect, w, h, grid); // 1 uvnitř (prázdná půda), 0 mimo
      const rand = createRandom(seed);
      for (let i = 0; i < w * h; i++) {
        if (grid[i] === EMPTY && rand() < INIT_DENSITY) grid[i] = TREE_MIN + Math.floor(rand() * (TREE_MAX - TREE_MIN + 1));
      }
    },
    step(src, dst, w, h, stepIndex) {
      const n = w * h;
      // Blesk: s pravděpodobností STRIKE zasáhne první strom od náhodné buňky (cyklicky).
      let strike = -1;
      if (rnd(0, stepIndex, 1) < STRIKE) {
        const start = Math.floor(rnd(0, stepIndex, 2) * n);
        for (let k = 0; k < n; k++) {
          const i = (start + k) % n;
          if (isTree(src[i])) { strike = i; break; }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = src[i];
          let next = v;
          if (v === 0) {
            next = 0;
          } else if (v === EMPTY) {
            if (rnd(i, stepIndex, 3) < GROW) next = TREE_MIN;
          } else if (v < TREE_MIN) {
            if (rnd(i, stepIndex, 4) < ASH_DECAY) next = v - 1;
          } else if (v >= BURN_MIN) {
            next = v === LIGHTNING ? BURN_START : v >= BURN_MIN + 8 ? v - 8 : ASH_MAX;
          } else if (i === strike) {
            next = LIGHTNING;
          } else {
            // strom: vzplane od žhavého souseda, jinak stárne
            let calm = 1;
            const l = x > 0, r = x < w - 1, u = y > 0, d = y < h - 1;
            if (l && src[i - 1] >= BURN_HOT) calm *= 1 - SPREAD_ORTHO;
            if (r && src[i + 1] >= BURN_HOT) calm *= 1 - SPREAD_ORTHO;
            if (u && src[i - w] >= BURN_HOT) calm *= 1 - SPREAD_ORTHO;
            if (d && src[i + w] >= BURN_HOT) calm *= 1 - SPREAD_ORTHO;
            if (l && u && src[i - w - 1] >= BURN_HOT) calm *= 1 - SPREAD_DIAG;
            if (r && u && src[i - w + 1] >= BURN_HOT) calm *= 1 - SPREAD_DIAG;
            if (l && d && src[i + w - 1] >= BURN_HOT) calm *= 1 - SPREAD_DIAG;
            if (r && d && src[i + w + 1] >= BURN_HOT) calm *= 1 - SPREAD_DIAG;
            if (calm < 1 && rnd(i, stepIndex, 5) >= calm) next = BURN_START;
            else if (v < TREE_MAX) next = v + 1;
          }
          dst[i] = next;
        }
      }
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  vec2 g = vLocal * uStateSize;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float aa = max(fwidth(g.x), 0.01);
  ivec2 hi = ivec2(uStateSize) - 1;
  float b = floor(texelFetch(uState, clamp(ivec2(cell), ivec2(0), hi), 0).r * 255.0 + 0.5);
  float rn = hash(cell);

  // blesk: bílý záblesk kolem zasažené buňky, během kroku slábne
  float flash = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      float s = floor(texelFetch(uState, clamp(ivec2(cell) + ivec2(dx, dy), ivec2(0), hi), 0).r * 255.0 + 0.5);
      if (s > 254.5) flash = max(flash, 1.0 - length(vec2(float(dx), float(dy)) - f) / 3.2);
    }
  }
  flash = clamp(flash, 0.0, 1.0);
  flash = flash * flash * (1.0 - uStateFrac * 0.8);

  vec3 col = vec3(0.0);
  float d = length(max(abs(f) - 0.36, 0.0)) - 0.1;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  if (b >= 200.0) {
    // oheň: bílé jádro, oranžový plamen, tmavě červené doznívání, blikání v čase
    float heat = clamp((b - 200.0) / 40.0, 0.0, 1.0);
    float flick = 0.8 + 0.3 * hash(cell + floor(t * 12.0) * 7.31);
    vec3 dark = vec3(0.3, 0.02, 0.0);
    col = mix(dark, uColB, smoothstep(0.0, 0.6, heat));
    col = mix(col, vec3(1.0, 0.95, 0.75), smoothstep(0.7, 1.0, heat) * 0.8);
    col *= flick;
    fill = max(fill, 0.85 * (1.0 - smoothstep(0.45, 0.6, max(abs(f.x), abs(f.y)))));
  } else if (b >= 16.0) {
    // strom: starší je sytější, každá buňka má vlastní odstín
    float age = (b - 16.0) / 95.0;
    col = uColA * (0.35 + 0.5 * age) * (0.85 + 0.3 * rn);
  } else if (b >= 2.0) {
    col = vec3(0.2) * (b - 1.0) / 8.0;
  } else {
    fill = 0.0;
  }
  col *= fill;
  return mix(col, vec3(1.0), flash);`,
};
