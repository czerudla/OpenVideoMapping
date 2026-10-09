// Elementární automat (Wolfram) – jednorozměrný buněčný automat, stavová animace (`sim`).
// Mřížka je kruhový buffer řádků (nejvýše 255) plus jeden vyhrazený řádek navíc: buňka 0 drží index
// nejnovějšího řádku, buňka 1 číslo pravidla. Shader podle indexu roluje, nový řádek je nahoře.
import { createRandom, gridSize, MAX_GRID } from '../sim-utils.js';

const COLUMNS = 128; // sloupců mřížky
const RULES = [30, 45, 73, 90, 105, 110, 150, 182]; // zajímavá pravidla, každý cyklus jedno
const ALIVE = 255;

// Spočítá nový řádek `to` z řádku `from` podle pravidla (okolí 3 buněk, okraje dokola).
function nextRow(src, dst, w, from, to, rule) {
  for (let x = 0; x < w; x++) {
    const l = src[from + (x + w - 1) % w] ? 4 : 0;
    const c = src[from + x] ? 2 : 0;
    const r = src[from + (x + 1) % w] ? 1 : 0;
    dst[to + x] = (rule >> (l | c | r)) & 1 ? ALIVE : 0;
  }
}

export default {
  id: 'rule30',
  name: 'Elementární automat',
  colors: 2,
  sim: {
    // Pevný počet sloupců, počet řádků podle poměru stran oblasti (čtvercové buňky), +1 vyhrazený řádek.
    size(points, aspect) {
      const g = gridSize(points, aspect, MAX_GRID);
      const rows = Math.max(1, Math.min(MAX_GRID - 1, Math.round((COLUMNS * g.h) / g.w)));
      return { w: COLUMNS, h: rows + 1 };
    },
    stepsPerSecond: 12,
    stepsPerCycle: 600,
    init(grid, w, h, seed) {
      const rand = createRandom(seed);
      const rule = RULES[Math.floor(rand() * RULES.length)];
      const meta = (h - 1) * w;
      grid[meta] = 0; // index nejnovějšího řádku
      grid[meta + 1] = rule;
      if (rand() < 0.5) grid[Math.floor(w / 2)] = ALIVE; // jediná živá buňka uprostřed
      else for (let x = 0; x < w; x++) grid[x] = rand() < 0.5 ? ALIVE : 0;
    },
    step(src, dst, w, h) {
      const rows = h - 1;
      const meta = rows * w;
      dst.set(src);
      const head = src[meta];
      const next = (head + 1) % rows;
      dst[meta] = next;
      nextRow(src, dst, w, head * w, next * w, src[meta + 1]);
    },
  },
  glsl: `float rows = uStateSize.y - 1.0;
  if (uStateSize.x <= 0.0 || rows < 1.0) return vec3(0.0);
  // nejnovější řádek je nahoře, obraz je o (1 - uStateFrac) řádku níž a plynule se posouvá
  float s = vLocal.y * rows - (1.0 - uStateFrac);
  if (s < 0.0) return vec3(0.0);
  float k = floor(s);
  float head = floor(texelFetch(uState, ivec2(0, int(rows)), 0).r * 255.0 + 0.5);
  float row = mod(head - k, rows);
  float col = min(floor(vLocal.x * uStateSize.x), uStateSize.x - 1.0);
  float v = texelFetch(uState, ivec2(int(col), int(row)), 0).r;
  if (v < 0.5) return vec3(0.0);
  // zaoblený čtverec s drobnou mezerou
  vec2 f = vec2(fract(vLocal.x * uStateSize.x), fract(s)) - 0.5;
  float aa = max(fwidth(s), 0.01);
  float d = length(max(abs(f) - 0.36, 0.0)) - 0.08;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  return mix(uColA, uColB, clamp(s / rows, 0.0, 1.0)) * fill;`,
};
