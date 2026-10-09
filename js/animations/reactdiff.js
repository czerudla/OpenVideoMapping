// Reakce a difuze – model Gray-Scott (Turingovy vzory), stavová animace (`sim`, rgba32f).
// Texel: R = koncentrace A, G = koncentrace B, B = 0 mimo oblast, jinak 1 + index režimu, A = jas (prolnutí cyklů).
// Maska oblasti a index režimu jsou přímo ve stavu, protože `step` nezná polygon. Okraj masky je Neumannův
// (laplacián počítá jen sousedy uvnitř masky). Každý cyklus běží jeden režim (feed, kill) ze seznamu.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 96; // buněk na delší straně oblasti
const ITERATIONS = 10; // iterací Gray-Scott na jeden krok simulace
const STEPS_PER_SECOND = 12;
const STEPS_PER_CYCLE = 480; // 40 s
const FADE_IN = 30; // kroků, než se nový vzor plně rozsvítí
const FADE_OUT = 40; // kroků ztmavení na konci cyklu
const DU = 0.2097;
const DV = 0.105;
const DT = 1;
const SEED_DENSITY = 300; // jedno semínko na tolik buněk

// Známé režimy: [feed, kill].
const REGIMES = [
  [0.0545, 0.062], // korály
  [0.0367, 0.0649], // mitóza (dělící se buňky)
  [0.029, 0.057], // bludiště
  [0.03, 0.062], // skvrny (solitony)
  [0.014, 0.045], // vlny
];

// Dočasné buffery jen pro jedno volání `step` (okraj šířky 1 s nulovou maskou, takže bez kontroly mezí).
let scratchSize = 0;
let U0, V0, U1, V1, M;

function ensureScratch(n) {
  if (scratchSize < n) {
    U0 = new Float32Array(n);
    V0 = new Float32Array(n);
    U1 = new Float32Array(n);
    V1 = new Float32Array(n);
    M = new Float32Array(n);
    scratchSize = n;
  }
  M.fill(0, 0, n); // okraj musí být nulový i po jiné velikosti mřížky
}

export default {
  id: 'reactdiff',
  group: 'sim',
  name: 'Reakce a difuze',
  colors: 2,
  sim: {
    format: 'rgba32f',
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: STEPS_PER_SECOND,
    stepsPerCycle: STEPS_PER_CYCLE,
    init(grid, w, h, seed, points, aspect) {
      const rand = createRandom(seed);
      const regime = Math.floor(rand() * REGIMES.length);
      const mask = polygonMask(points, aspect, w, h);
      const inside = [];
      for (let i = 0; i < w * h; i++) {
        if (!mask[i]) continue;
        inside.push(i);
        grid[i * 4] = 1;
        grid[i * 4 + 2] = 1 + regime;
      }
      if (!inside.length) return;
      const seeds = Math.max(6, Math.round(inside.length / SEED_DENSITY));
      for (let s = 0; s < seeds; s++) {
        const c = inside[Math.floor(rand() * inside.length)];
        const cx = c % w, cy = Math.floor(c / w);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
            const i = (y * w + x) * 4;
            grid[i] = 0.5;
            grid[i + 1] = 0.25;
          }
        }
      }
    },
    step(src, dst, w, h, stepIndex) {
      const W = w + 2;
      ensureScratch(W * (h + 2));
      let regime = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const p = (y + 1) * W + x + 1;
          const tag = src[i + 2];
          M[p] = tag > 0 ? 1 : 0;
          U0[p] = src[i];
          V0[p] = src[i + 1];
          if (tag > 0) regime = tag - 1;
        }
      }
      const feed = REGIMES[regime][0];
      const kill = REGIMES[regime][1];
      let u0 = U0, v0 = V0, u1 = U1, v1 = V1;
      for (let it = 0; it < ITERATIONS; it++) {
        for (let y = 1; y <= h; y++) {
          for (let x = 1; x <= w; x++) {
            const p = y * W + x;
            if (M[p] === 0) continue;
            const a = p - W - 1, b = p - W, c = p - W + 1, d = p - 1, e = p + 1, f = p + W - 1, g = p + W, k = p + W + 1;
            const u = u0[p], v = v0[p];
            const lu = 0.05 * (M[a] * (u0[a] - u) + M[c] * (u0[c] - u) + M[f] * (u0[f] - u) + M[k] * (u0[k] - u))
              + 0.2 * (M[b] * (u0[b] - u) + M[d] * (u0[d] - u) + M[e] * (u0[e] - u) + M[g] * (u0[g] - u));
            const lv = 0.05 * (M[a] * (v0[a] - v) + M[c] * (v0[c] - v) + M[f] * (v0[f] - v) + M[k] * (v0[k] - v))
              + 0.2 * (M[b] * (v0[b] - v) + M[d] * (v0[d] - v) + M[e] * (v0[e] - v) + M[g] * (v0[g] - v));
            const uvv = u * v * v;
            const nu = u + DT * (DU * lu - uvv + feed * (1 - u));
            const nv = v + DT * (DV * lv + uvv - (feed + kill) * v);
            u1[p] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
            v1[p] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
          }
        }
        const tu = u0; u0 = u1; u1 = tu;
        const tv = v0; v0 = v1; v1 = tv;
      }
      const next = stepIndex + 1;
      const fade = Math.min(1, next / FADE_IN, (STEPS_PER_CYCLE - next) / FADE_OUT);
      const light = fade < 0 ? 0 : fade;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const p = (y + 1) * W + x + 1;
          const inside = M[p] !== 0;
          dst[i] = inside ? u0[p] : 0;
          dst[i + 1] = inside ? v0[p] : 0;
          dst[i + 2] = src[i + 2];
          dst[i + 3] = light;
        }
      }
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  ivec2 hi = ivec2(uStateSize) - 1;
  // bilineární vzorkování středů buněk, aby nebyly vidět čtverce
  vec2 p = vLocal * uStateSize - 0.5;
  vec2 i = floor(p), f = p - i;
  ivec2 a = clamp(ivec2(i), ivec2(0), hi);
  ivec2 b = clamp(ivec2(i) + 1, ivec2(0), hi);
  vec4 s00 = texelFetch(uState, ivec2(a.x, a.y), 0), s10 = texelFetch(uState, ivec2(b.x, a.y), 0);
  vec4 s01 = texelFetch(uState, ivec2(a.x, b.y), 0), s11 = texelFetch(uState, ivec2(b.x, b.y), 0);
  vec4 s = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
  // gradient koncentrace B (reliéf)
  vec2 grad = vec2(mix(s10.g - s00.g, s11.g - s01.g, f.y), mix(s01.g - s00.g, s11.g - s10.g, f.x));
  float c = smoothstep(0.08, 0.3, s.g);
  vec3 col = mix(uColB, uColA, c);
  float relief = clamp(dot(grad, vec2(-0.7, -0.7)) * 6.0, -0.5, 0.5);
  col = clamp(col * (1.0 + relief), 0.0, 1.0);
  return col * clamp(s.a, 0.0, 1.0);`,
};
