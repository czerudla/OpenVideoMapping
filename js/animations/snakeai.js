// Had (volný) – klasický Snake po celé ploše oblasti, stavová animace (`sim`, formát r8).
// Had sám hledá cestu k jídlu (BFS) a před každým tahem hlídá, aby po něm dosáhl na svůj ocas.
// Hodnota buňky: 0 volno, 1 zeď (mimo polygon), 2 jídlo, 8–12 hlava, 16+ tělo (viz níže).
// Hlava a tělo nesou směr k dalšímu článku (0 doprava, 1 dolů, 2 doleva, 3 nahoru, 4 žádný = ocas),
// tělo navíc úroveň ztmavnutí 0–15. Řízení hry (fáze, seed, růst, hlava, jídlo) je ve vyhrazených
// řádcích pod mřížkou, takže veškerý stav leží v poli simulace.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 40; // buněk na delší straně oblasti
const START_LEN = 4;
const GROW_BY = 2; // o kolik článků had po snězení jídla povyroste
const FILL_LIMIT = 0.5; // konec hry při zaplnění tohoto podílu volné plochy
const BLINK_STEPS = 12; // 3 probliknutí po 4 krocích
const CRUMBLE_STEPS = 10;
const PAUSE_STEPS = 6;

const EMPTY = 0;
const WALL = 1;
const FOOD = 2;
const HEAD = 8;
const BODY = 16;
const NONE = 4;

// Pole řízení, uložené v bytech za mřížkou.
const M_PHASE = 0; // 0 hra, 1 konec hry
const M_TIMER = 1; // kroky od konce hry
const M_SEED = 2; // 4 byty
const M_GROW = 6; // zbývající články k dorostení
const M_HX = 7;
const M_HY = 8;
const M_FX = 9; // 255 = žádné jídlo
const M_FY = 10;
const M_AREA = 11; // volná plocha, 2 byty
const M_ALIVE = 13; // 1, pokud na mřížce je had
const META_COUNT = 14;
const NO_FOOD = 255;

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

// Dočasná paměť jednoho volání `step` (řetěz článků, fronta a rodiče BFS), nenese stav mezi kroky.
let chain = new Int32Array(2048);
let queue = new Int32Array(2048);
let parent = new Int32Array(2048);
let dist = new Int32Array(2048);

function ensureBuffers(n) {
  if (chain.length >= n) return;
  chain = new Int32Array(n);
  queue = new Int32Array(n);
  parent = new Int32Array(n);
  dist = new Int32Array(n);
}

const metaRows = (w) => Math.ceil(META_COUNT / w);

// Index souseda buňky `i` ve směru `d`, nebo -1 mimo mřížku.
function neighbor(i, d, w, h) {
  const x = (i % w) + DX[d];
  const y = Math.floor(i / w) + DY[d];
  return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x;
}

// BFS z `start` do `goal` po volných buňkách (0, jídlo a případně `vacated`, tedy uvolněný ocas).
// Vrací délku cesty nebo -1; do `parent` zapisuje rodiče pro zpětné dohledání první buňky cesty.
function bfs(g, w, h, start, goal, vacated) {
  const n = w * h;
  dist.fill(-1, 0, n);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  parent[start] = -1;
  while (head < tail) {
    const cur = queue[head++];
    for (let d = 0; d < 4; d++) {
      const nb = neighbor(cur, d, w, h);
      if (nb < 0 || dist[nb] >= 0) continue;
      if (nb === goal) {
        parent[nb] = cur;
        dist[nb] = dist[cur] + 1;
        return dist[nb];
      }
      if (g[nb] !== EMPTY && g[nb] !== FOOD && nb !== vacated) continue;
      dist[nb] = dist[cur] + 1;
      parent[nb] = cur;
      queue[tail++] = nb;
    }
  }
  return -1;
}

// Načte řetěz článků od hlavy k ocasu do `chain`, vrátí jeho délku.
function readChain(g, w, h, headCell) {
  const max = w * h;
  let len = 0;
  let cur = headCell;
  while (len < max) {
    chain[len++] = cur;
    const v = g[cur];
    const d = v >= BODY ? (v - BODY) & 7 : v - HEAD;
    if (d >= NONE) break;
    cur = neighbor(cur, d, w, h);
    if (cur < 0) break;
  }
  return len;
}

// Délka cesty z buňky `c` (nová hlava) k ocasu hada po tahu; -1, pokud tam had nedojde.
function tailDistance(g, w, h, len, grow, c) {
  const tail = chain[len - 1];
  const vacated = grow > 0 ? -1 : tail;
  const goal = grow > 0 ? tail : chain[len - 2];
  return bfs(g, w, h, c, goal, vacated);
}

function writeSnake(g, w, len) {
  for (let i = 0; i < len; i++) {
    let d = NONE;
    if (i < len - 1) {
      const diff = chain[i + 1] - chain[i];
      d = diff === 1 ? 0 : diff === w ? 1 : diff === -1 ? 2 : 3;
    }
    g[chain[i]] = i === 0 ? HEAD + d : BODY + Math.floor((15 * i) / Math.max(len - 1, 1)) * 8 + d;
  }
}

function get16(g, base, k) {
  return g[base + k] | (g[base + k + 1] << 8);
}

function set16(g, base, k, v) {
  g[base + k] = v & 255;
  g[base + k + 1] = (v >> 8) & 255;
}

// Umístí jídlo na náhodnou volnou buňku; false, pokud žádná není.
function placeFood(g, w, h, base, rand) {
  let free = 0;
  for (let i = 0; i < w * h; i++) if (g[i] === EMPTY) free++;
  if (free === 0) {
    g[base + M_FX] = NO_FOOD;
    return false;
  }
  let k = Math.floor(rand() * free);
  for (let i = 0; i < w * h; i++) {
    if (g[i] !== EMPTY) continue;
    if (k-- === 0) {
      g[i] = FOOD;
      g[base + M_FX] = i % w;
      g[base + M_FY] = Math.floor(i / w);
      return true;
    }
  }
  return false;
}

// Nová hra: vyčistí volné buňky, položí krátkého hada a jídlo. Zdi zůstávají.
function newGame(g, w, h, base, rand) {
  for (let i = 0; i < w * h; i++) if (g[i] !== WALL) g[i] = EMPTY;
  g[base + M_PHASE] = 0;
  g[base + M_TIMER] = 0;
  g[base + M_GROW] = 0;
  g[base + M_FX] = NO_FOOD;
  g[base + M_ALIVE] = 0;
  const fits = (x, y, d) => {
    for (let k = 0; k < START_LEN; k++) {
      const px = x - DX[d] * k;
      const py = y - DY[d] * k;
      if (px < 0 || py < 0 || px >= w || py >= h || g[py * w + px] !== EMPTY) return false;
    }
    return true;
  };
  let sx = -1, sy = -1, sd = 0;
  for (let a = 0; a < 64 && sx < 0; a++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const d = Math.floor(rand() * 4);
    if (fits(x, y, d)) { sx = x; sy = y; sd = d; }
  }
  for (let i = 0; i < w * h && sx < 0; i++) {
    for (let d = 0; d < 4 && sx < 0; d++) {
      if (fits(i % w, Math.floor(i / w), d)) { sx = i % w; sy = Math.floor(i / w); sd = d; }
    }
  }
  if (sx < 0) return; // oblast je příliš malá, hra se nespustí
  for (let k = 0; k < START_LEN; k++) chain[k] = (sy - DY[sd] * k) * w + (sx - DX[sd] * k);
  writeSnake(g, w, START_LEN);
  g[base + M_HX] = sx;
  g[base + M_HY] = sy;
  g[base + M_ALIVE] = 1;
  placeFood(g, w, h, base, rand);
}

function startDying(g, base) {
  g[base + M_PHASE] = 1;
  g[base + M_TIMER] = 0;
  g[base + M_FX] = NO_FOOD;
}

// Vybere buňku dalšího tahu, nebo -1 při nárazu (žádné volné sousedství).
function chooseMove(g, w, h, base, len, grow) {
  const headCell = chain[0];
  const tail = chain[len - 1];
  const vacated = grow > 0 ? -1 : tail;
  const isFree = (c) => c >= 0 && (g[c] === EMPTY || g[c] === FOOD || c === vacated);
  const fx = g[base + M_FX];
  if (fx !== NO_FOOD) {
    const food = g[base + M_FY] * w + fx;
    if (bfs(g, w, h, headCell, food, vacated) > 0) {
      let c = food;
      while (parent[c] !== headCell) c = parent[c];
      if (tailDistance(g, w, h, len, grow, c) >= 0) return c;
    }
  }
  // Cesta k jídlu není, nebo by had uvízl: jde za ocasem (nejdelší bezpečná cesta), jinak kamkoli.
  let best = -1;
  let bestDist = -1;
  let any = -1;
  for (let d = 0; d < 4; d++) {
    const c = neighbor(headCell, d, w, h);
    if (!isFree(c)) continue;
    if (any < 0) any = c;
    const td = tailDistance(g, w, h, len, grow, c);
    if (td > bestDist) { bestDist = td; best = c; }
  }
  return bestDist >= 0 ? best : any;
}

export default {
  id: 'snakeai',
  group: 'games',
  name: 'Had (volný)',
  colors: 2,
  sim: {
    // Čtvercové buňky; pod mřížku se přidají řádky s řízením hry (shader je odečte podle šířky).
    size(points, aspect) {
      const s = gridSize(points, aspect, CELLS_LONG);
      return { w: s.w, h: s.h + metaRows(s.w) };
    },
    stepsPerSecond: 10,
    stepsPerCycle: 12000,
    init(grid, w, fullH, seed, points, aspect) {
      const h = fullH - metaRows(w);
      const base = w * h;
      ensureBuffers(w * fullH);
      polygonMask(points, aspect, w, h, grid.subarray(0, base));
      let area = 0;
      for (let i = 0; i < base; i++) {
        grid[i] = grid[i] ? EMPTY : WALL;
        if (grid[i] === EMPTY) area++;
      }
      set16(grid, base, M_AREA, area);
      for (let k = 0; k < 4; k++) grid[base + M_SEED + k] = (seed >>> (8 * k)) & 255;
      newGame(grid, w, h, base, createRandom(seed));
    },
    step(src, dst, w, fullH, stepIndex) {
      dst.set(src);
      const h = fullH - metaRows(w);
      const base = w * h;
      const seed = (dst[base + M_SEED] | (dst[base + M_SEED + 1] << 8) | (dst[base + M_SEED + 2] << 16) | (dst[base + M_SEED + 3] << 24)) >>> 0;
      const rand = createRandom((seed ^ Math.imul(stepIndex + 1, 0x85ebca6b)) >>> 0);
      ensureBuffers(w * fullH);
      if (!dst[base + M_ALIVE]) return;

      // Konec hry: blikání, rozpad, pauza a nová hra.
      if (dst[base + M_PHASE] === 1) {
        const timer = ++dst[base + M_TIMER];
        const crumbleEnd = BLINK_STEPS + CRUMBLE_STEPS;
        if (timer > BLINK_STEPS && timer <= crumbleEnd) {
          const p = 1 / (crumbleEnd - timer + 1);
          for (let i = 0; i < base; i++) if (dst[i] >= HEAD && rand() < p) dst[i] = EMPTY;
        } else if (timer > crumbleEnd + PAUSE_STEPS) {
          newGame(dst, w, h, base, rand);
        }
        return;
      }

      const len = readChain(dst, w, h, dst[base + M_HY] * w + dst[base + M_HX]);
      let grow = dst[base + M_GROW];
      const c = len >= 3 ? chooseMove(dst, w, h, base, len, grow) : -1;
      if (c < 0) {
        startDying(dst, base);
        return;
      }
      const eat = dst[c] === FOOD;
      let keep = len;
      if (grow > 0) grow--;
      else {
        dst[chain[len - 1]] = EMPTY;
        keep = len - 1;
      }
      chain.copyWithin(1, 0, keep);
      chain[0] = c;
      const newLen = keep + 1;
      writeSnake(dst, w, newLen);
      dst[base + M_HX] = c % w;
      dst[base + M_HY] = Math.floor(c / w);
      if (eat) {
        grow += GROW_BY;
        if (newLen >= get16(dst, base, M_AREA) * FILL_LIMIT || !placeFood(dst, w, h, base, rand)) startDying(dst, base);
      }
      dst[base + M_GROW] = grow;
    },
  },
  glsl: `const int META = ${META_COUNT};
  if (uStateSize.x < 1.0) return vec3(0.0);
  int W = int(uStateSize.x);
  int H = int(uStateSize.y) - (META + W - 1) / W;
  vec2 grid = vec2(float(W), float(H));
  vec2 g = clamp(vLocal * grid, vec2(0.0), grid - 0.001);
  vec2 f = fract(g) - 0.5;
  float aa = max(fwidth(g.x), 0.01);
  int v = int(texelFetch(uState, ivec2(g), 0).r * 255.0 + 0.5);
  if (v < 2 || v == 3 || (v > 2 && v < 8)) return vec3(0.0);

  // Čtvercová políčka s mezerou, jídlo je menší a bliká.
  float d = max(abs(f.x), abs(f.y)) - (v == 2 ? 0.26 : 0.42);
  float box = 1.0 - smoothstep(-aa, aa, d);
  if (v == 2) return uColB * box * step(0.4, fract(t * 3.0));

  // Konec hry: blikání hada podle počítadla kroků.
  int timer = int(texelFetch(uState, ivec2(1 % W, H + 1 / W), 0).r * 255.0 + 0.5);
  bool dying = int(texelFetch(uState, ivec2(0, H), 0).r * 255.0 + 0.5) == 1;
  float vis = dying && timer < 12 && (timer / 2) % 2 == 1 ? 0.0 : 1.0;

  if (v < 16) return mix(uColA, vec3(1.0), 0.45) * box * vis;
  float level = float((v - 16) / 8) / 15.0;
  return uColA * mix(1.0, 0.45, level) * box * vis;`,
};
