// Hledání min (Minesweeper) hraje samo, stavová animace (`sim`, formát r8). Hrací pole má tvar oblasti.
// Hodnota buňky: 0 = mimo oblast, jinak bit 7 | stav << 4 (3 bity) | dolní 4 bity (0–8 min v okolí, 9 = mina).
// Stav: 0 zakryto, 1 odkryto, 2 vlajka, 3 vybuchlá mina, 4 odhalená mina po prohře, 5 odkryto při výhře,
// 6 vlajka při výhře, 7 vlajka při výhře s počítadlem. U stavů 3 a 7 jsou dolní bity „stáří“ konce hry (0–15).
// Hráč udělá jeden tah za krok: jistá pravidla (vlajky = číslo → odkrýt zbytek, zakrytá = číslo → vlajky),
// jinak hádá. Po konci hry se pole chvíli drží a pak začne nová hra (restart uvnitř `step`, bez stavu mimo pole).
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 24; // buněk na delší straně oblasti
const DENSITY = 0.15; // podíl min
const INSIDE = 128;
const MINE = 9;
const ST_COVERED = 0;
const ST_OPEN = 1;
const ST_FLAG = 2;
const ST_BOOM = 3;
const ST_MINE = 4;
const ST_WON = 5;
const ST_WON_FLAG = 6;
const ST_COUNTER = 7;
const MAX_AGE = 15;
const FAST_AGE = 12; // do tohoto stáří běží konec hry každý krok, pak jen každý druhý (pauza s hotovým polem)
const BOOM_SPEED = 3; // o kolik buněk se výbuch rozšíří za krok

// Číslice 1–8 (5×7) a ikony vlajky a miny (7×7): k = černá, r = barva A (vlajka), w = bílá.
const DIGITS = [
  ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
];
const ICONS = [
  ['..krr..', '..krrr.', '..krrrr', '..krrr.', '..krr..', '..k....', '.kkkk..'], // vlajka
  ['...k...', '.k.k.k.', '..kwk..', 'kkkkkkk', '..kkk..', '.k.k.k.', '...k...'], // mina
];
const NUM_COLORS = [
  [0.0, 0.0, 1.0], [0.0, 0.5, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.5],
  [0.5, 0.0, 0.0], [0.0, 0.5, 0.5], [0.0, 0.0, 0.0], [0.5, 0.5, 0.5],
];

// Řádky obrázku jako čísla, nejlevější pixel je nejvyšší bit.
const rowBits = (row, ch) => [...row].reduce((n, c) => (n << 1) | (c === ch || (ch === 'a' && c === '#') ? 1 : 0), 0);
const plane = (icons, ch) => icons.flat().map((r) => rowBits(r, ch));
const f = (n) => n.toFixed(3);

// Fronta pro vyplavení nul, jen dočasná paměť v rámci jednoho kroku (mřížka má nejvýše CELLS_LONG²).
const queue = new Int32Array(CELLS_LONG * CELLS_LONG);

const enc = (st, lo) => INSIDE | (st << 4) | lo;
const stOf = (v) => (v >> 4) & 7;
const loOf = (v) => v & 15;

// Nová hra: nenulové buňky `grid` jsou uvnitř oblasti, vyplní se minami a počty min v okolí.
function newGame(grid, w, h, seed) {
  const rand = createRandom(seed);
  let inside = 0;
  let mines = 0;
  for (let i = 0; i < w * h; i++) {
    if (!grid[i]) continue;
    inside++;
    const mine = rand() < DENSITY;
    grid[i] = mine ? 1 : 2;
    if (mine) mines++;
  }
  // Aspoň jedna mina a aspoň jedno bezpečné políčko.
  if (inside >= 2 && mines === 0) {
    let k = Math.floor(rand() * inside);
    for (let i = 0; i < w * h; i++) {
      if (grid[i] && k-- === 0) { grid[i] = 1; mines = 1; break; }
    }
  }
  if (inside > 0 && mines === inside) {
    for (let i = 0; i < w * h; i++) {
      if (grid[i]) { grid[i] = 2; break; }
    }
  }
  const isMine = (v) => v === 1 || v === enc(ST_COVERED, MINE);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!grid[i]) continue;
      if (isMine(grid[i])) { grid[i] = enc(ST_COVERED, MINE); continue; }
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h && isMine(grid[ny * w + nx])) n++;
        }
      }
      grid[i] = enc(ST_COVERED, n);
    }
  }
}

// Odkryje buňku; nula odkryje celé okolí (flood fill) v jednom kroku, mina vybuchne.
function reveal(grid, w, h, i) {
  if (!grid[i] || stOf(grid[i]) !== ST_COVERED) return;
  const lo = loOf(grid[i]);
  if (lo === MINE) { grid[i] = enc(ST_BOOM, 0); return; }
  grid[i] = enc(ST_OPEN, lo);
  if (lo !== 0) return;
  let head = 0, tail = 0;
  queue[tail++] = i;
  while (head < tail) {
    const c = queue[head++];
    const x = c % w, y = (c / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!grid[j] || stOf(grid[j]) !== ST_COVERED) continue;
        const l = loOf(grid[j]);
        grid[j] = enc(ST_OPEN, l);
        if (l === 0) queue[tail++] = j;
      }
    }
  }
}

// Restart: z buněk uvnitř oblasti se postaví nová hra.
function restart(src, dst, w, h, seed) {
  for (let i = 0; i < w * h; i++) dst[i] = src[i] ? 1 : 0;
  newGame(dst, w, h, seed);
}

function step(src, dst, w, h, stepIndex) {
  dst.set(src);
  const n = w * h;
  let hash = 2166136261;
  let total = 0, special = -1, opened = 0, covered = 0, safeCovered = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (!v) continue;
    total++;
    hash = Math.imul(hash ^ v, 16777619) >>> 0;
    const st = stOf(v);
    if (st === ST_BOOM || st === ST_COUNTER) special = i;
    if (st === ST_COVERED) {
      covered++;
      if (loOf(v) !== MINE) safeCovered++;
    } else opened++;
  }
  if (!total) return;
  const seed = (hash ^ Math.imul(stepIndex + 1, 0x9e3779b1)) >>> 0;
  const rand = createRandom(seed);

  // Konec hry: výbuch se šíří, po dosažení maximálního stáří začne nová hra.
  if (special >= 0) {
    const st = stOf(src[special]);
    const age = loOf(src[special]);
    if (age >= MAX_AGE) { restart(src, dst, w, h, seed); return; }
    const next = age >= FAST_AGE && (stepIndex & 1) ? age : age + 1;
    dst[special] = enc(st, next);
    if (st === ST_BOOM) {
      const ox = special % w, oy = (special / w) | 0;
      const r2 = (next * BOOM_SPEED) ** 2;
      for (let i = 0; i < n; i++) {
        if (src[i] && stOf(src[i]) === ST_COVERED && loOf(src[i]) === MINE
          && ((i % w) - ox) ** 2 + (((i / w) | 0) - oy) ** 2 <= r2) dst[i] = enc(ST_MINE, MINE);
      }
    }
    return;
  }

  // Výhra: odkryto vše bezpečné, zbylé miny se označí a pole se rozzáří.
  if (safeCovered === 0) {
    // Počítadlo konce hry nese první mina (v poli bez min první buňka).
    let counter = -1;
    for (let i = 0; i < n; i++) {
      if (src[i] && loOf(src[i]) === MINE) { counter = i; break; }
    }
    for (let i = 0; i < n; i++) {
      if (!src[i]) continue;
      if (counter < 0) counter = i;
      if (loOf(src[i]) === MINE) dst[i] = enc(ST_WON_FLAG, MINE);
      else if (stOf(src[i]) === ST_OPEN) dst[i] = enc(ST_WON, loOf(src[i]));
    }
    dst[counter] = enc(ST_COUNTER, 0);
    return;
  }

  // První tah je vždy bezpečný, pokud lze, tak na nule.
  if (opened === 0) {
    let zeros = 0, safe = 0;
    for (let i = 0; i < n; i++) {
      if (!src[i] || loOf(src[i]) === MINE) continue;
      safe++;
      if (loOf(src[i]) === 0) zeros++;
    }
    const wantZero = zeros > 0;
    let k = Math.floor(rand() * (wantZero ? zeros : safe));
    for (let i = 0; i < n; i++) {
      if (!src[i] || loOf(src[i]) === MINE || (wantZero && loOf(src[i]) !== 0)) continue;
      if (k-- === 0) { reveal(dst, w, h, i); return; }
    }
    return;
  }

  // Jistá pravidla: číslo, které už má kolem sebe správný počet vlajek nebo zakrytých polí.
  const start = Math.floor(rand() * n);
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const v = src[i];
    const num = loOf(v);
    if (!v || stOf(v) !== ST_OPEN || num < 1 || num > 8) continue;
    const x = i % w, y = (i / w) | 0;
    let cov = 0, flags = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h || !src[ny * w + nx]) continue;
        const s = stOf(src[ny * w + nx]);
        if (s === ST_COVERED) cov++;
        else if (s === ST_FLAG) flags++;
      }
    }
    if (cov === 0 || (flags !== num && cov + flags !== num)) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!src[j] || stOf(src[j]) !== ST_COVERED) continue;
        if (flags === num) reveal(dst, w, h, j);
        else dst[j] = enc(ST_FLAG, MINE);
      }
    }
    return;
  }

  // Nic jistého: hádá náhodné zakryté políčko (může vybuchnout).
  let k = Math.floor(rand() * covered);
  for (let i = 0; i < n; i++) {
    if (src[i] && stOf(src[i]) === ST_COVERED && k-- === 0) { reveal(dst, w, h, i); return; }
  }
}

const arr = (name, values) => `const int ${name}[${values.length}] = int[${values.length}](${values.join(', ')});`;

export default {
  id: 'minesweeper',
  group: 'games',
  name: 'Hledání min',
  colors: 2,
  sim: {
    // Čtvercové buňky: poměr mřížky odpovídá poměru stran ohraničujícího obdélníku oblasti na obrazovce.
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 4,
    stepsPerCycle: 960,
    init(grid, w, h, seed, points, aspect) {
      polygonMask(points, aspect, w, h, grid);
      newGame(grid, w, h, seed);
    },
    step,
  },
  glsl: `${arr('DIG', DIGITS.flatMap((d) => d.map((r) => rowBits(r, 'a'))))}
  ${arr('ICK', plane(ICONS, 'k'))}
  ${arr('ICA', plane(ICONS, 'r'))}
  ${arr('ICW', plane(ICONS, 'w'))}
  const vec3 NUM[8] = vec3[8](${NUM_COLORS.map((c) => `vec3(${c.map(f).join(', ')})`).join(', ')});
  if (uStateSize.x <= 0.0) return vec3(0.0);
  vec2 g = vLocal * uStateSize;
  ivec2 c = clamp(ivec2(floor(g)), ivec2(0), ivec2(uStateSize) - 1);
  int v = int(texelFetch(uState, c, 0).r * 255.0 + 0.5);
  if (v < 128) return vec3(0.0);
  int st = (v >> 4) & 7;
  int lo = v & 15;
  // Pixelová mřížka 9×9 v buňce (hrana 1 pixel, číslice 5×7, ikony 7×7).
  ivec2 p = clamp(ivec2(floor(fract(g) * 9.0)), ivec2(0), ivec2(8));
  bool boom = st == 3;
  bool open = st == 1 || st == 5 || st == 4 || boom;
  bool won = st >= 5;
  float glow = won ? 0.5 + 0.5 * sin(t * 5.0 - (g.x + g.y) * 0.45) : 0.0;

  vec3 col;
  if (open) {
    col = boom ? mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.9, 0.0), step(0.5, fract(t * 3.0)) * 0.6) : vec3(0.75);
    if (p.x == 0 || p.y == 0) col *= 0.65;
    col = mix(col, mix(uColA, vec3(1.0), 0.5), glow * 0.8);
  } else {
    col = uColB;
    if (p.x <= 1 && p.y <= 7 || p.y <= 1 && p.x <= 7) col = mix(uColB, vec3(1.0), 0.55);
    else if (p.x >= 7 || p.y >= 7) col = mix(uColB, vec3(0.0), 0.5);
    col = mix(col, mix(uColA, vec3(1.0), 0.5), glow * 0.5);
  }

  // Číslice.
  if (open && !boom && st != 4 && lo >= 1 && lo <= 8) {
    ivec2 q = p - ivec2(2, 1);
    if (q.x >= 0 && q.x < 5 && q.y >= 0 && q.y < 7 && ((DIG[(lo - 1) * 7 + q.y] >> (4 - q.x)) & 1) == 1) col = NUM[lo - 1];
  }

  // Ikona vlajky nebo miny.
  bool mine = st == 3 || st == 4;
  if (mine || st == 2 || st >= 6) {
    ivec2 q = p - ivec2(1, 1);
    if (q.x >= 0 && q.x < 7 && q.y >= 0 && q.y < 7) {
      int row = (mine ? 7 : 0) + q.y;
      int sh = 6 - q.x;
      if (((ICW[row] >> sh) & 1) == 1) col = vec3(1.0);
      if (((ICA[row] >> sh) & 1) == 1) col = uColA;
      if (((ICK[row] >> sh) & 1) == 1) col = vec3(0.0);
    }
  }
  return col;`,
};
