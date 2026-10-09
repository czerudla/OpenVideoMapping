// Brian's Brain – třístavový buněčný automat (zapnuto → vyhasíná → vypnuto), stavová animace (`sim`).
// Hodnota buňky v textuře: 255 = zapnutá, 128 = vyhasínající, 0 = vypnutá, 1 = mimo polygon (trvale mrtvá).
// Maska oblasti je uložená přímo ve stavu (hodnota 1), `step` nepotřebuje nic mimo pole `src`/`dst`.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const ON = 255;
const DYING = 128;
const OUTSIDE = 1;
const MIN_DENSITY = 0.15;
const MAX_DENSITY = 0.25;
const MIN_ACTIVITY = 0.005; // pod tímto podílem zapnutých buněk přidá `step` jiskru
const SPARK_RADIUS = 5;
const SPARK_DENSITY = 0.5;

// Přidá do `grid` shluk zapnutých buněk kolem náhodné buňky uvnitř polygonu (mimo polygon nic nezapíná).
function spark(grid, w, h, rand) {
  let cx = -1, cy = -1;
  for (let tries = 0; tries < 64; tries++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    if (grid[y * w + x] !== OUTSIDE) { cx = x; cy = y; break; }
  }
  if (cx < 0) return;
  for (let y = Math.max(0, cy - SPARK_RADIUS); y <= Math.min(h - 1, cy + SPARK_RADIUS); y++) {
    for (let x = Math.max(0, cx - SPARK_RADIUS); x <= Math.min(w - 1, cx + SPARK_RADIUS); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= SPARK_RADIUS * SPARK_RADIUS && grid[y * w + x] !== OUTSIDE && rand() < SPARK_DENSITY) {
        grid[y * w + x] = ON;
      }
    }
  }
}

export default {
  id: 'briansbrain',
  name: 'Brian\'s Brain',
  colors: 2,
  sim: {
    // Čtvercové buňky: poměr mřížky odpovídá poměru stran ohraničujícího obdélníku oblasti na obrazovce.
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 12,
    stepsPerCycle: 1200,
    init(grid, w, h, seed, points, aspect) {
      polygonMask(points, aspect, w, h, grid);
      const rand = createRandom(seed);
      const density = MIN_DENSITY + (MAX_DENSITY - MIN_DENSITY) * rand();
      for (let i = 0; i < w * h; i++) {
        grid[i] = grid[i] ? (rand() < density ? ON : 0) : OUTSIDE;
      }
    },
    step(src, dst, w, h, stepIndex) {
      let inside = 0;
      let on = 0;
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(h - 1, y + 1);
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = src[i];
          if (v === OUTSIDE) {
            dst[i] = OUTSIDE;
            continue;
          }
          inside++;
          if (v === ON) {
            dst[i] = DYING;
          } else if (v === DYING) {
            dst[i] = 0;
          } else {
            const x0 = Math.max(0, x - 1);
            const x1 = Math.min(w - 1, x + 1);
            let n = 0;
            for (let yy = y0; yy <= y1; yy++) {
              for (let xx = x0; xx <= x1; xx++) {
                if ((xx !== x || yy !== y) && src[yy * w + xx] === ON) n++;
              }
            }
            dst[i] = n === 2 ? ON : 0;
            if (n === 2) on++;
          }
        }
      }
      // Aktivita vymírá: místo plného restartu přidej jiskru (deterministicky ze stepIndex).
      if (inside > 0 && on < inside * MIN_ACTIVITY) {
        spark(dst, w, h, createRandom(Math.imul(stepIndex + 1, 0x9e3779b1) ^ (w * h)));
      }
    },
  },
  glsl: `vec2 g = vLocal * uStateSize;
  float aa = max(fwidth(g.x), 0.01);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  ivec2 hi = ivec2(uStateSize) - 1;
  float v = 0.0;
  float glow = 0.0;
  if (uStateSize.x > 0.0) {
    // střed buňky a jemná záře od zapnutých sousedů (3×3)
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        ivec2 c = clamp(ivec2(cell) + ivec2(i, j), ivec2(0), hi);
        float s = texelFetch(uState, c, 0).r;
        if (i == 0 && j == 0) v = s;
        if (s > 0.9) {
          vec2 d = f - vec2(float(i), float(j));
          glow += exp(-dot(d, d) * 2.5);
        }
      }
    }
  }
  // zaoblený čtverec s mezerou mezi buňkami
  float d = length(max(abs(f) - 0.26, 0.0)) - 0.12;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  vec3 col = uColA * min(glow * 0.12, 0.35) * (1.0 - fill);
  if (v > 0.9) {
    col += uColA * fill;
  } else if (v > 0.4 && v < 0.6) {
    // vyhasínající buňka plynule slábne do dalšího kroku
    col += uColB * (0.75 * (1.0 - uStateFrac)) * fill;
  }
  return col;`,
};
