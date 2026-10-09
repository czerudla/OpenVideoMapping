// Langtonův mravenec – buněčný automat s 1–4 mravenci a různými pravidly (RL, RLR, …), stavová animace (`sim`, rgba8).
// Kanály buňky: R = barva políčka (0 = nenavštíveno, jinak 1–255 pozice v gradientu uColA → uColB),
// G = mravenec (0 = žádný, jinak (1 + směr) * 50), B = zářící stopa, A = 0 mimo oblast, jinak (zásahy okraje << 3) | (1 + pravidlo).
// Veškerý stav je v poli, `step` si z něj bere pravidlo i počet zásahů okraje.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const RULES = ['RL', 'RLR', 'LLRR', 'LRRRRRLLR', 'RRLLLRLLLRRR'];
const TURNS = RULES.map((r) => [...r].map((c) => (c === 'R' ? 1 : 3))); // přírůstek směru: vpravo +1, vlevo +3
const MAX_ANTS = 4;
const MAX_HITS = 6; // tolik odrazů od okraje a začne nový cyklus
const MAX_STEPS_PER_TICK = 1000; // strop kroků mravence na jeden krok simulace (kvůli rozpočtu 4 ms)
const GLOW_STEPS = 8; // poslední kroky každé dávky zanechávají zářící stopu
const GLOW_FADE = 40;
const DX = [0, 1, 0, -1]; // směry: nahoru, doprava, dolů, doleva
const DY = [-1, 0, 1, 0];

// Dočasná paměť v rámci jednoho volání `step`.
const ax = new Int32Array(MAX_ANTS);
const ay = new Int32Array(MAX_ANTS);
const ad = new Int32Array(MAX_ANTS);

// Zvolí pravidlo a mravence, vynuluje barvy a stopy; buňky mimo oblast (A = 0) nechá být.
function populate(grid, w, h, rand) {
  const rule = Math.floor(rand() * RULES.length);
  let first = -1;
  for (let i = 0; i < w * h; i++) {
    grid[i * 4] = 0;
    grid[i * 4 + 1] = 0;
    grid[i * 4 + 2] = 0;
    if (grid[i * 4 + 3]) {
      grid[i * 4 + 3] = 1 + rule;
      if (first < 0) first = i;
    }
  }
  if (first < 0) return;
  const count = rand() < 0.6 ? 1 : 2 + Math.floor(rand() * (MAX_ANTS - 1));
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  let placed = 0;
  for (let attempt = 0; placed < count && attempt < 400; attempt++) {
    const spread = placed === 0 ? 0 : Math.max(2, Math.floor(Math.min(w, h) / 8));
    const x = Math.max(0, Math.min(w - 1, cx + Math.round((rand() - 0.5) * 2 * spread)));
    const y = Math.max(0, Math.min(h - 1, cy + Math.round((rand() - 0.5) * 2 * spread)));
    const i = y * w + x;
    if (!grid[i * 4 + 3] || grid[i * 4 + 1]) continue;
    grid[i * 4 + 1] = (1 + Math.floor(rand() * 4)) * 50;
    placed++;
  }
  if (!placed) grid[first * 4 + 1] = 50; // střed leží mimo oblast, mravenec začne v prvním vnitřním políčku
}

function newCycleRandom(stepIndex, rule) {
  return createRandom((Math.imul(stepIndex + 1, 0x9e3779b1) ^ Math.imul(rule + 1, 0x85ebca6b)) >>> 0);
}

export default {
  id: 'langton',
  name: 'Langtonův mravenec',
  colors: 2,
  sim: {
    format: 'rgba8',
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 8,
    stepsPerCycle: 900,
    init(grid, w, h, seed, points, aspect) {
      const mask = polygonMask(points, aspect, w, h);
      for (let i = 0; i < w * h; i++) grid[i * 4 + 3] = mask[i];
      populate(grid, w, h, createRandom(seed));
    },
    step(src, dst, w, h, stepIndex) {
      let ants = 0;
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        dst[o] = src[o];
        dst[o + 1] = src[o + 1];
        dst[o + 2] = src[o + 2] > GLOW_FADE ? src[o + 2] - GLOW_FADE : 0;
        dst[o + 3] = src[o + 3];
        if (src[o + 1] && ants < MAX_ANTS) {
          ax[ants] = i % w;
          ay[ants] = (i - (i % w)) / w;
          ad[ants] = src[o + 1] / 50 - 1;
          ants++;
        }
      }
      if (!ants) return;
      const meta = dst[(ay[0] * w + ax[0]) * 4 + 3];
      const rule = (meta & 7) - 1;
      let hits = meta >> 3;
      const turns = TURNS[rule];
      const n = turns.length;
      const span = Math.max(n - 2, 1);
      // Rychlost zrychluje: na začátku cyklu málo kroků mravence, později stovky.
      const k = Math.min(MAX_STEPS_PER_TICK, 1 + Math.floor((stepIndex * stepIndex) / 400));
      for (let s = 0; s < k; s++) {
        const glow = s >= k - GLOW_STEPS;
        for (let a = 0; a < ants; a++) {
          const o = (ay[a] * w + ax[a]) * 4;
          const r = dst[o];
          const c = r === 0 ? 0 : 1 + Math.round(((r - 1) * span) / 254);
          const next = (c + 1) % n;
          dst[o] = next === 0 ? 0 : 1 + Math.round((254 * (next - 1)) / span);
          dst[o + 1] = 0;
          let d = (ad[a] + turns[c]) % 4;
          const nx = ax[a] + DX[d];
          const ny = ay[a] + DY[d];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !dst[(ny * w + nx) * 4 + 3]) {
            hits++;
            d = (d + 2) % 4; // odraz od okraje: otočení o 180°, mravenec zůstane
          } else if (!dst[(ny * w + nx) * 4 + 1]) {
            ax[a] = nx;
            ay[a] = ny;
          } else {
            d = (d + 2) % 4; // políčko zabírá jiný mravenec
          }
          ad[a] = d;
          const p = (ay[a] * w + ax[a]) * 4;
          dst[p + 1] = (1 + d) * 50;
          if (glow) dst[p + 2] = 255;
        }
        if (hits >= MAX_HITS) {
          populate(dst, w, h, newCycleRandom(stepIndex, rule)); // dálnice dorazila na kraj
          return;
        }
      }
      if (hits !== meta >> 3) {
        const m = (hits << 3) | (rule + 1);
        for (let i = 0; i < w * h; i++) if (dst[i * 4 + 3]) dst[i * 4 + 3] = m;
      }
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  vec2 g = vLocal * uStateSize;
  float aa = max(fwidth(g.x), 0.01);
  vec2 f = abs(fract(g) - 0.5);
  vec4 v = texture(uState, (floor(g) + 0.5) / uStateSize);
  if (v.a <= 0.0) return vec3(0.0);
  float edge = max(f.x, f.y);
  if (v.g > 0.0) {
    // mravenec: jasný čtverec přes celé políčko
    return vec3(1.0) * (1.0 - smoothstep(0.5 - aa, 0.5 + aa, edge));
  }
  float fill = 1.0 - smoothstep(0.46 - aa, 0.46 + aa, edge);
  float t = clamp((v.r * 255.0 - 1.0) / 254.0, 0.0, 1.0);
  vec3 col = v.r > 0.0 ? mix(uColA, uColB, t) : vec3(0.0);
  col = mix(col, vec3(1.0), v.b * v.b * 0.7);
  return col * fill;`,
};
