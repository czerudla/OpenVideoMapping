// Tetris – do oblasti padají tetromina, skládají se odspodu a plné řady se zablikají a smažou.
// Hru odsimuluje JS (precompute) jednoduchou „AI“, shader podle času přehraje pád kusů a stav pole.
// Po vyčerpání tahů (nebo zaplnění pole) pole zabliká, zmizí a hra začne znovu.
// Rozložení uData: [0] = (sloupců, řádků, velikost buňky, x levého okraje mřížky),
// [1] = (y horního okraje mřížky, počet kusů, rychlost pádu v řádcích za sekundu, délka cyklu),
// od indexu 8 (float) jeden kus na float: typ (3 bity) | otočení << 3 (2) | sloupec << 5 (5) |
// spodní řádek << 10 (6) | maska smazaných řádků << 16 (4, bit i = řádek spodní + i).
// Souřadnice mají poměr stran (x * aspect, y), y roste dolů.
const MAX_PIECES = 100; // počet kusů ve hře, vejde se do MAX_DATA (64 × vec4)
const MAX_COLS = 24;
const MAX_ROWS = 48;
const MIN_ROWS = 8;
const FALL_T = 0.9; // doba pádu z horního okraje až dolů (s)
const START = 0.4; // čekání před prvním kusem
const GAP = 0.1; // pauza mezi kusy
const FLASH = 0.5; // blikání plných řad
const SLIDE = 0.25; // pád řad nad smazanými
const HOLD = 1.2; // pauza s hotovým polem
const BLINK = 1.0; // blikání pole před restartem
const PAUSE = 0.6; // černá pauza před restartem
const NOISE = 1.5; // náhodnost výběru tahu, aby pole neustále nezůstávalo prázdné

// Tvary I, O, T, S, Z, J, L jako buňky (x, y), y roste nahoru.
const BASE = [
  [[0, 1], [1, 1], [2, 1], [3, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 1], [1, 1], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [2, 0], [0, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
];

// SHAPES[typ * 4 + otočení] = {cells, mask (4×4 bity, bit dy * 4 + dx), w, h}
const SHAPES = BASE.flatMap((cells) => {
  const out = [];
  let cur = cells;
  for (let r = 0; r < 4; r++) {
    const minX = Math.min(...cur.map((c) => c[0]));
    const minY = Math.min(...cur.map((c) => c[1]));
    const norm = cur.map(([x, y]) => [x - minX, y - minY]);
    out.push({
      cells: norm,
      mask: norm.reduce((m, [x, y]) => m | (1 << (y * 4 + x)), 0),
      w: Math.max(...norm.map((c) => c[0])) + 1,
      h: Math.max(...norm.map((c) => c[1])) + 1,
    });
    cur = cur.map(([x, y]) => [y, -x]);
  }
  return out;
});

// Klasická paleta: I, O, T, S, Z, J, L.
const COLORS = [
  [0.0, 0.9, 0.9], [0.95, 0.9, 0.0], [0.65, 0.1, 0.9], [0.1, 0.85, 0.15],
  [0.92, 0.1, 0.1], [0.15, 0.25, 0.95], [0.97, 0.55, 0.05],
];
const f = (n) => n.toFixed(3);

// Deterministický generátor z celočíselného otisku bodů (editor i výstup dostanou totéž).
function seedFrom(points) {
  let h = 2166136261;
  for (const [x, y] of points) {
    for (const v of [Math.round(x * 1e5), Math.round(y * 1e5)]) {
      h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
    }
  }
  return h;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function popcount(v) {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
}

// Velikost buňky a rozměr mřížky podle rozměrů oblasti (čtvercové buňky, cca 10–14 sloupců).
function gridFor(bw, bh) {
  let cols = Math.min(14, Math.max(10, Math.round(12 * Math.sqrt(bw / bh))));
  let cell = bw / cols;
  cell = Math.min(cell, bh / MIN_ROWS);
  cell = Math.max(cell, bh / MAX_ROWS);
  cell = Math.min(cell, bw / 5);
  cols = Math.min(MAX_COLS, Math.floor(bw / cell + 1e-6));
  const rows = Math.min(MAX_ROWS, Math.floor(bh / cell + 1e-6));
  return { cols, rows, cell };
}

// Nejnižší volná poloha kusu při pádu shora v daném sloupci; -1, když by přesahoval nahoru.
function landing(board, rows, shape, col) {
  const fits = (y) => {
    for (const [dx, dy] of shape.cells) {
      const r = y + dy;
      if (r < 0) return false;
      if (r < rows && (board[r] >> (col + dx)) & 1) return false;
    }
    return true;
  };
  let y = rows;
  while (fits(y - 1)) y--;
  return y + shape.h > rows ? -1 : y;
}

// Ohodnocení pole po položení kusu (agregovaná výška, řady, díry, nerovnost povrchu).
function evaluate(board, rows, cols, scratch, heights) {
  const full = (1 << cols) - 1;
  let used = 0;
  let lines = 0;
  for (let r = 0; r < rows; r++) {
    if (board[r] === full) lines++;
    else scratch[used++] = board[r];
  }
  let above = 0;
  let holes = 0;
  heights.fill(0);
  for (let r = used - 1; r >= 0; r--) {
    const row = scratch[r];
    holes += popcount(~row & above & full);
    let fresh = row & ~above;
    for (let c = 0; fresh; c++, fresh >>= 1) if (fresh & 1) heights[c] = r + 1;
    above |= row;
  }
  let agg = 0;
  let bump = 0;
  for (let c = 0; c < cols; c++) {
    agg += heights[c];
    if (c > 0) bump += Math.abs(heights[c] - heights[c - 1]);
  }
  return -0.51 * agg + 0.76 * lines - 0.36 * holes - 0.18 * bump;
}

function precompute(points, aspect) {
  const none = new Float32Array(0);
  if (!(points.length >= 3)) return none;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of points) {
    minX = Math.min(minX, px * aspect); maxX = Math.max(maxX, px * aspect);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const bw = maxX - minX, bh = maxY - minY;
  if (!(bw > 1e-6 && bh > 1e-6)) return none;

  const { cols, rows, cell } = gridFor(bw, bh);
  if (cols < 5) return none;
  const ox = minX + (bw - cols * cell) / 2;
  const oy = minY + (bh - rows * cell) / 2;

  const rnd = mulberry32(seedFrom(points));
  const full = (1 << cols) - 1;
  let board = new Int32Array(rows);
  const trial = new Int32Array(rows);
  const scratch = new Int32Array(rows);
  const heights = new Int32Array(cols);
  const rate = rows / FALL_T;
  const packed = [];
  let time = START;
  let end = START;

  for (let n = 0; n < MAX_PIECES; n++) {
    const typ = Math.floor(rnd() * 7);
    let best = null;
    let bestScore = -Infinity;
    for (let rot = 0; rot < 4; rot++) {
      const shape = SHAPES[typ * 4 + rot];
      for (let col = 0; col + shape.w <= cols; col++) {
        const y = landing(board, rows, shape, col);
        if (y < 0) continue;
        trial.set(board);
        for (const [dx, dy] of shape.cells) trial[y + dy] |= 1 << (col + dx);
        const score = evaluate(trial, rows, cols, scratch, heights) + (rnd() - 0.5) * NOISE;
        if (score > bestScore) { bestScore = score; best = { rot, col, y, shape }; }
      }
    }
    if (!best) break; // pole je plné

    const { rot, col, y, shape } = best;
    for (const [dx, dy] of shape.cells) board[y + dy] |= 1 << (col + dx);
    let clear = 0;
    for (let i = 0; i < 4; i++) if (y + i < rows && board[y + i] === full) clear |= 1 << i;
    if (clear) {
      const kept = [];
      for (let r = 0; r < rows; r++) if (!(r >= y && r < y + 4 && (clear >> (r - y)) & 1)) kept.push(board[r]);
      board = Int32Array.from({ length: rows }, (_, r) => kept[r] ?? 0);
    }
    packed.push(typ | (rot << 3) | (col << 5) | (y << 10) | (clear << 16));

    // Stejný časový průběh jako ve shaderu: pád, blikání a sesunutí řad, pauza.
    const land = time + (rows - y) / rate;
    end = land + (clear ? FLASH + SLIDE : 0);
    time = end + GAP;
  }
  if (!packed.length) return none;

  const out = new Float32Array(Math.ceil((8 + packed.length) / 4) * 4);
  out.set([cols, rows, cell, ox, oy, packed.length, rate, end + HOLD + BLINK + PAUSE]);
  packed.forEach((v, i) => { out[8 + i] = v; });
  return out;
}

export default {
  id: 'tetris',
  name: 'Tetris',
  colors: 0,
  precompute,
  glsl: `const int SHAPES[28] = int[28](${SHAPES.map((s) => s.mask).join(', ')});
  const vec3 COLORS[7] = vec3[7](${COLORS.map((c) => `vec3(${c.map(f).join(', ')})`).join(', ')});
  vec3 black = vec3(0.0);
  if (uDataCount < 3) return black;
  int cols = int(uData[0].x + 0.5);
  int rows = int(uData[0].y + 0.5);
  float cell = uData[0].z;
  vec2 org = vec2(uData[0].w, uData[1].x);
  int n = int(uData[1].y + 0.5);
  float rate = uData[1].z;
  float tt = mod(t, uData[1].w);

  // Poloha v mřížce: x doprava, y nahoru od spodního okraje, jednotka = buňka.
  vec2 q = vUV * vec2(uAspect, 1.0);
  vec2 g = vec2((q.x - org.x) / cell, float(rows) - (q.y - org.y) / cell);
  if (g.x < 0.0 || g.x >= float(cols) || g.y < 0.0 || g.y >= float(rows)) return black;

  // Aktuální kus: poslední, který už začal padat.
  float s = ${f(START)};
  float sk = 0.0;
  float lk = 0.0;
  float cd = 0.0;
  int k = -1;
  int vk = 0;
  for (int j = 0; j < ${MAX_PIECES}; j++) {
    if (j >= n || tt < s) break;
    int i = j + 8;
    int v = int(uData[i >> 2][i & 3] + 0.5);
    float l = s + float(rows - ((v >> 10) & 63)) / rate;
    float d = ((v >> 16) & 15) != 0 ? ${f(FLASH + SLIDE)} : 0.0;
    k = j; vk = v; sk = s; lk = l; cd = d;
    s = l + d + ${f(GAP)};
  }
  if (k < 0) return black;
  int ybk = (vk >> 10) & 63;
  int clrk = (vk >> 16) & 15;
  bool falling = tt < lk;
  int m = falling ? k - 1 : k;

  // Blikání celého pole po posledním kusu, pak zmizí.
  bool whole = false;
  if (k == n - 1) {
    float ue = tt - (lk + cd) - ${f(HOLD)};
    if (ue >= ${f(BLINK)}) return black;
    whole = ue >= 0.0 && fract(ue / ${f(BLINK)} * 3.0) < 0.5;
  }

  // Hledaná buňka pole; při mazání řad se hledá v poloze před smazáním.
  int cx = int(floor(g.x));
  int cr = int(floor(g.y));
  vec2 lf = fract(g);
  bool skipFirst = false;
  bool flash = false;
  if (!falling && cd > 0.0 && tt < lk + cd) {
    skipFirst = true;
    float u = tt - lk;
    if (u < ${f(FLASH)}) {
      int rel = cr - ybk;
      flash = rel >= 0 && rel < 4 && ((clrk >> rel) & 1) == 1;
      flash = flash && fract(u / ${f(FLASH)} * 2.0) < 0.5;
    } else {
      float p = smoothstep(0.0, 1.0, (u - ${f(FLASH)}) / ${f(SLIDE)});
      cr = -1;
      for (int sh = 0; sh <= 4; sh++) {
        float yp = g.y + float(sh) * p;
        int ro = int(floor(yp));
        int rel = ro - ybk;
        bool gone = rel >= 0 && rel < 4 && ((clrk >> rel) & 1) == 1;
        int below = 0;
        for (int b = 0; b < 4; b++) {
          if (((clrk >> b) & 1) == 1 && ybk + b < ro) below++;
        }
        if (!gone && below == sh && ro >= 0 && ro < rows) {
          cr = ro;
          lf.y = fract(yp);
          break;
        }
      }
    }
  }

  // Zpětné hledání: od posledního položeného kusu zpět, vždy nejdřív vrátit jeho smazané řady.
  int kind = -1;
  if (cr >= 0) {
    int r = cr;
    for (int i = 0; i < ${MAX_PIECES}; i++) {
      int j = m - i;
      if (j < 0) break;
      int w = j == k ? vk : int(uData[(j + 8) >> 2][(j + 8) & 3] + 0.5);
      int yb = (w >> 10) & 63;
      if (!(skipFirst && i == 0)) {
        for (int b = 0; b < 4; b++) {
          if ((((w >> 16) >> b) & 1) == 1 && r >= yb + b) r++;
        }
      }
      int dx = cx - ((w >> 5) & 31);
      int dy = r - yb;
      if (dx >= 0 && dx < 4 && dy >= 0 && dy < 4 &&
          ((SHAPES[(w & 7) * 4 + ((w >> 3) & 3)] >> (dy * 4 + dx)) & 1) == 1) {
        kind = w & 7;
        break;
      }
    }
  }

  // Padající kus.
  if (falling) {
    float u = clamp((tt - sk) / max(lk - sk, 1e-4), 0.0, 1.0);
    vec2 pl = g - vec2(float((vk >> 5) & 31), mix(float(rows), float(ybk), u));
    if (pl.x >= 0.0 && pl.x < 4.0 && pl.y >= 0.0 && pl.y < 4.0) {
      int bit = int(floor(pl.y)) * 4 + int(floor(pl.x));
      if (((SHAPES[(vk & 7) * 4 + ((vk >> 3) & 3)] >> bit) & 1) == 1) {
        kind = vk & 7;
        lf = fract(pl);
      }
    }
  }
  if (kind < 0) return black;

  // Retro kostka: světlejší horní a levá hrana, tmavší dolní a pravá.
  vec3 base = COLORS[kind];
  if (flash || whole) base = mix(base, vec3(1.0), 0.85);
  const float B = 0.14;
  if (lf.x < B || lf.y > 1.0 - B) return mix(base, vec3(1.0), 0.5);
  if (lf.x > 1.0 - B || lf.y < B) return mix(base, black, 0.5);
  return base;`,
};
