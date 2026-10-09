// Mráz na skle – větvené ledové krystaly rostou od okrajů oblasti dovnitř, stavová animace (`sim`, r8).
// Hodnota buňky: 0 = mimo oblast, 1 = čisté sklo, 128–255 = led (255 právě přimrzl, stárne k 128),
// 2–127 = tající led. Když led pokryje ~70 % oblasti, mráz roztaje a růst začne znovu od hran.
// Stav je jen v mřížce, náhodná čísla se odvozují z kroku a hashe mřížky (deterministicky).
import { createRandom, gridSize, polygonMask, boundaryCells } from '../sim-utils.js';

const CELLS_LONG = 160; // buněk na delší straně oblasti
const SEED_SHARE = 0.2; // podíl okrajových buněk, ze kterých krystaly vyrůstají
const GLASS = 1;
const ICE_MIN = 128;
const ICE_MAX = 255;
const MELT_STEP = 2; // úbytek za krok, tání trvá ~3 s
const COVERAGE = 0.7; // podíl ledu, od kterého mráz taje
// Pravděpodobnost přimrznutí prázdné buňky podle počtu zamrzlých sousedů (8-okolí), 4-okolí musí mít led.
const FREEZE_P = [0, 0.12, 0.012, 0.006, 0.006, 0.006, 0.006, 0.006, 0.006];

// Dočasné mřížky pro masku a okraj, platí jen v rámci jednoho volání init/step.
let scratch = new Uint8Array(0);
let scratchEdge = new Uint8Array(0);

function ensureScratch(n) {
  if (scratch.length < n) {
    scratch = new Uint8Array(n);
    scratchEdge = new Uint8Array(n);
  }
}

// Zapíše do mřížky masku (sklo) a semínka krystalů na okraji.
function seedGrid(grid, n, mask, edge, rand) {
  let seeded = 0;
  let firstEdge = -1;
  for (let i = 0; i < n; i++) {
    grid[i] = mask[i] ? GLASS : 0;
    if (!edge[i]) continue;
    if (firstEdge < 0) firstEdge = i;
    if (rand() < SEED_SHARE) {
      grid[i] = ICE_MAX;
      seeded++;
    }
  }
  if (!seeded && firstEdge >= 0) grid[firstEdge] = ICE_MAX;
}

export default {
  id: 'frost',
  name: 'Mráz na skle',
  colors: 2,
  sim: {
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 20,
    stepsPerCycle: 6000,
    init(grid, w, h, seed, points, aspect) {
      ensureScratch(w * h);
      polygonMask(points, aspect, w, h, scratch);
      boundaryCells(scratch, w, h, scratchEdge);
      seedGrid(grid, w * h, scratch, scratchEdge, createRandom(seed));
    },
    step(src, dst, w, h, stepIndex) {
      const n = w * h;
      let glass = 0, ice = 0, melting = 0, hash = Math.imul(stepIndex + 1, 0x9e3779b1);
      for (let i = 0; i < n; i++) {
        const v = src[i];
        hash = (Math.imul(hash ^ v, 0x01000193) + i) | 0;
        if (v >= ICE_MIN) ice++;
        else if (v > GLASS) melting++;
        if (v >= GLASS) glass++;
      }
      if (!glass) { dst.set(src); return; }
      let rs = (hash >>> 0) || 1;
      const rand = () => {
        rs ^= rs << 13; rs >>>= 0;
        rs ^= rs >>> 17;
        rs ^= rs << 5; rs >>>= 0;
        return rs / 4294967296;
      };
      if (melting || ice >= glass * COVERAGE) {
        // tání: veškerý led (i čerstvý) přejde do rozsahu 64–127 a pak postupně mizí
        for (let i = 0; i < n; i++) {
          const v = src[i];
          if (v >= ICE_MIN) dst[i] = 64 + ((v - ICE_MIN) >> 1);
          else if (v > GLASS) dst[i] = v - MELT_STEP > GLASS ? v - MELT_STEP : GLASS;
          else dst[i] = v;
        }
        return;
      }
      if (!ice) {
        // po roztátí vyrostou semínka znovu na okraji
        ensureScratch(n);
        for (let i = 0; i < n; i++) scratch[i] = src[i] ? 1 : 0;
        boundaryCells(scratch, w, h, scratchEdge);
        seedGrid(dst, n, scratch, scratchEdge, rand);
        return;
      }
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const i = row + x;
          const v = src[i];
          if (v >= ICE_MIN) { dst[i] = v > ICE_MIN ? v - 1 : ICE_MIN; continue; }
          dst[i] = v;
          if (v !== GLASS) continue;
          // okrajové buňky nezamrzají (rostou jen ze semínek), led se šíří dovnitř
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
          const nl = src[i - 1], nr = src[i + 1], nu = src[i - w], nd = src[i + w];
          if (!nl || !nr || !nu || !nd) continue;
          const c4 = (nl >= ICE_MIN) + (nr >= ICE_MIN) + (nu >= ICE_MIN) + (nd >= ICE_MIN);
          if (!c4) continue;
          const c8 = c4 + (src[i - w - 1] >= ICE_MIN) + (src[i - w + 1] >= ICE_MIN)
            + (src[i + w - 1] >= ICE_MIN) + (src[i + w + 1] >= ICE_MIN);
          if (rand() < FREEZE_P[c8]) dst[i] = ICE_MAX;
        }
      }
    },
  },
  glsl: `vec2 g = vLocal * uStateSize - 0.5;
  vec2 i0 = floor(g);
  vec2 f = g - i0;
  ivec2 hi = ivec2(uStateSize) - 1;
  float wsum[4];
  float bsum[4];
  for (int k = 0; k < 4; k++) {
    ivec2 c = clamp(ivec2(i0) + ivec2(k & 1, k >> 1), ivec2(0), hi);
    float v = uStateSize.x > 0.0 ? texelFetch(uState, c, 0).r * 255.0 : 0.0;
    float grow = step(127.5, v);
    float melt = step(1.5, v) * (1.0 - grow);
    float wgt = grow + melt * v / 127.0;
    wsum[k] = wgt;
    bsum[k] = wgt * mix(0.5 + 0.5 * v / 127.0, 0.5 + 0.5 * (v - 128.0) / 127.0, grow);
  }
  float iw = mix(mix(wsum[0], wsum[1], f.x), mix(wsum[2], wsum[3], f.x), f.y);
  float ib = mix(mix(bsum[0], bsum[1], f.x), mix(bsum[2], bsum[3], f.x), f.y);
  float edge = smoothstep(0.2, 0.6, iw);
  float bright = ib / max(iw, 0.001);
  // čerstvé hroty zbělají, led se slabě třpytí
  vec2 cell = floor(vLocal * uStateSize * 2.0);
  float tw = hash(cell + floor(uTime * 6.0 + hash(cell) * 6.0));
  float spark = step(0.97, tw) * step(0.3, edge);
  vec3 ice = uColA * (0.45 + 0.55 * bright) + vec3(smoothstep(0.85, 1.0, bright) * 0.5 + spark * 0.6);
  vec3 glass = uColB * 0.6;
  return mix(glass, min(ice, vec3(1.0)), edge);`,
};
