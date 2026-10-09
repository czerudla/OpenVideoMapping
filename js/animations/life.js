// Hra života – Conwayův buněčný automat (B3/S23) na torusu, stavová animace (`sim`).
// Hodnota buňky v textuře: 255 = právě narozená, 232 = živá, 208 a níž = doznívající stopa po mrtvé.
// Stagnaci (stav se nemění nebo osciluje s periodou 1–2) hlídá `step` z historie uložené mimo mřížku.
const CELLS_LONG = 64; // buněk na delší straně oblasti
const BORN = 255;
const ALIVE = 232;
const ALIVE_MIN = 224; // od této hodnoty je buňka živá
const TRAIL = 208;
const FADE = 16; // úbytek stopy za generaci
const STAGNATION_STEPS = 24; // ~3 s při 8 generacích za sekundu
const DENSITY = 0.3;

// Známé vzory: seznam [x, y] živých buněk a rozměr (w × h).
const GLIDER = { w: 3, h: 3, cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] };
const R_PENTOMINO = { w: 3, h: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]] };
const GUN = {
  w: 36,
  h: 9,
  cells: [
    [24, 0], [22, 1], [24, 1], [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
    [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3], [0, 4], [1, 4], [10, 4], [16, 4], [20, 4], [21, 4],
    [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5], [22, 5], [24, 5], [10, 6], [16, 6], [24, 6],
    [11, 7], [15, 7], [12, 8], [13, 8],
  ],
};
const PULSAR = {
  w: 13,
  h: 13,
  cells: [0, 5, 7, 12].flatMap((y) => [2, 3, 4, 8, 9, 10].map((x) => [x, y]))
    .concat([2, 3, 4, 8, 9, 10].flatMap((y) => [0, 5, 7, 12].map((x) => [x, y]))),
};

// Historie pro detekci stagnace, sdílená oběma poli oblasti (pole se po každém kroku prohazují).
const meta = new WeakMap();
// Seed předaný do `init`, klíčem je mřížka, do které se zapisovalo.
const seeds = new WeakMap();

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFill(grid, w, h, seed) {
  const rand = rng(seed);
  for (let i = 0; i < w * h; i++) grid[i] = rand() < DENSITY ? BORN : 0;
}

// Vloží vzor na pozici (ox, oy), volitelně zrcadlený, s přetečením přes okraj (torus).
function place(grid, w, h, pat, ox, oy, flipX, flipY) {
  for (const [cx, cy] of pat.cells) {
    const x = (ox + (flipX ? pat.w - 1 - cx : cx)) % w;
    const y = (oy + (flipY ? pat.h - 1 - cy : cy)) % h;
    grid[y * w + x] = BORN;
  }
}

function fillPattern(grid, w, h, seed) {
  const rand = rng(seed ^ 0x5bd1e995);
  const kind = Math.floor(rand() * 4);
  if (kind === 0 && w >= 40 && h >= 12) {
    place(grid, w, h, GUN, 2, 2 + Math.floor(rand() * (h - 11)), false, false);
  } else if (kind === 1) {
    place(grid, w, h, R_PENTOMINO, Math.floor((w - 3) / 2), Math.floor((h - 3) / 2), false, false);
  } else if (kind === 2 && w >= 15 && h >= 15) {
    place(grid, w, h, PULSAR, Math.floor((w - 13) / 2), Math.floor((h - 13) / 2), false, false);
  } else {
    const count = 4 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      place(grid, w, h, GLIDER, Math.floor(rand() * w), Math.floor(rand() * h), rand() < 0.5, rand() < 0.5);
    }
  }
}

export default {
  id: 'life',
  name: 'Hra života',
  colors: 2,
  sim: {
    // Čtvercové buňky: poměr mřížky odpovídá poměru stran ohraničujícího obdélníku oblasti na obrazovce.
    size(points, aspect) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of points) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const bw = Math.max((x1 - x0) * aspect, 1e-3);
      const bh = Math.max(y1 - y0, 1e-3);
      const k = CELLS_LONG / Math.max(bw, bh);
      return {
        w: Math.max(1, Math.min(CELLS_LONG, Math.round(bw * k))),
        h: Math.max(1, Math.min(CELLS_LONG, Math.round(bh * k))),
      };
    },
    stepsPerSecond: 8,
    stepsPerCycle: 1200,
    init(grid, w, h, seed) {
      seeds.set(grid, seed);
      if ((seed >>> 8) % 4 === 0) fillPattern(grid, w, h, seed);
      else randomFill(grid, w, h, seed);
    },
    step(src, dst, w, h, stepIndex) {
      let m = meta.get(src);
      if (stepIndex === 0 || !m) {
        m = { seed: seeds.get(src) ?? 1, still: 0, older: new Uint8Array(w * h).fill(2) };
        meta.set(src, m);
        meta.set(dst, m);
      }
      for (let y = 0; y < h; y++) {
        const up = ((y + h - 1) % h) * w;
        const row = y * w;
        const down = ((y + 1) % h) * w;
        for (let x = 0; x < w; x++) {
          const l = (x + w - 1) % w;
          const r = (x + 1) % w;
          const n = (src[up + l] >= ALIVE_MIN) + (src[up + x] >= ALIVE_MIN) + (src[up + r] >= ALIVE_MIN)
            + (src[row + l] >= ALIVE_MIN) + (src[row + r] >= ALIVE_MIN)
            + (src[down + l] >= ALIVE_MIN) + (src[down + x] >= ALIVE_MIN) + (src[down + r] >= ALIVE_MIN);
          const v = src[row + x];
          let next;
          if (v >= ALIVE_MIN) next = n === 2 || n === 3 ? ALIVE : TRAIL;
          else if (n === 3) next = BORN;
          else next = v > FADE ? v - FADE : 0;
          dst[row + x] = next;
        }
      }
      // Stagnace: nový stav se (co do živých buněk) shoduje se stavem před 1 nebo 2 generacemi.
      let same1 = true, same2 = true;
      for (let i = 0; i < w * h; i++) {
        const now = dst[i] >= ALIVE_MIN ? 1 : 0;
        if (now !== (src[i] >= ALIVE_MIN ? 1 : 0)) same1 = false;
        if (now !== m.older[i]) same2 = false;
        m.older[i] = src[i] >= ALIVE_MIN ? 1 : 0;
      }
      m.still = same1 || same2 ? m.still + 1 : 0;
      if (m.still >= STAGNATION_STEPS) {
        // Restart dřív než po stepsPerCycle, seed jen z deterministických hodnot.
        const seed = (m.seed ^ Math.imul(stepIndex + 1, 0x85ebca6b)) >>> 0;
        dst.fill(0);
        if ((seed >>> 8) % 4 === 0) fillPattern(dst, w, h, seed);
        else randomFill(dst, w, h, seed);
        m.still = 0;
        m.older.fill(2);
      }
    },
  },
  glsl: `vec2 g = vLocal * uStateSize;
  float aa = max(fwidth(g.x), 0.01);
  vec2 f = fract(g) - 0.5;
  float v = uStateSize.x > 0.0 ? texture(uState, (floor(g) + 0.5) / uStateSize).r : 0.0;
  // zaoblený čtverec s mezerou mezi buňkami
  float d = length(max(abs(f) - 0.26, 0.0)) - 0.12;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  if (v >= 0.875) {
    // právě narozená buňka (255) krátce zazáří
    float flash = v > 0.99 ? (1.0 - uStateFrac) * 0.6 : 0.0;
    return mix(uColA, vec3(1.0), flash) * fill;
  }
  float trail = v / 0.875;
  return uColB * trail * trail * fill;`,
};
