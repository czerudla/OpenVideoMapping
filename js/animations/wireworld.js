// Wireworld – Brian Silverman (1987), stavová animace (`sim`): po drátech obvodu podobného plošnému spoji běhají elektrony.
// Hodnota buňky v textuře: 0 = prázdno, 64 = vodič, 160 = ocas elektronu, 255 = hlava elektronu.
// Obvod se v `init` generuje deterministicky na mřížce uzlů o rozteči 2 buňky (dráty se tak elektricky nedotýkají),
// doplňují ho rámečky (čipy), hodiny (smyčka s kolujícím elektronem) a krátké úseky pod 45°.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 96; // buněk na delší straně oblasti
const COND = 64;
const TAIL = 160;
const HEAD = 255;
const FILL = 0.42; // podíl uzlů, který se pokusí obsadit dráty

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function shuffled(rand, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Vygeneruje obvod do `grid` uvnitř `mask`. Uzel (i, j) leží v buňce (2i + 1, 2j + 1).
function generate(grid, w, h, seed, mask) {
  const rand = createRandom(seed);
  const nx = (w - 1) >> 1;
  const ny = (h - 1) >> 1;
  if (nx < 2 || ny < 2) return;
  // Stav uzlu: 0 mimo oblast, 1 volný, 2 obsazený (lze se napojit), 3 zablokovaný (vnitřek čipu).
  const node = new Uint8Array(nx * ny);
  let allowed = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (mask[(2 * j + 1) * w + 2 * i + 1]) { node[j * nx + i] = 1; allowed++; }
    }
  }
  if (allowed < 4) return;
  const edgeOk = (i, j, d) => mask[(2 * j + 1 + DIRS[d][1]) * w + 2 * i + 1 + DIRS[d][0]] === 1;
  const link = (i, j, d) => {
    const x = 2 * i + 1;
    const y = 2 * j + 1;
    grid[y * w + x] = COND;
    grid[(y + DIRS[d][1]) * w + x + DIRS[d][0]] = COND;
    grid[(y + 2 * DIRS[d][1]) * w + x + 2 * DIRS[d][0]] = COND;
  };
  const used = [];
  const take = (i, j) => { node[j * nx + i] = 2; used.push([i, j]); };
  // Souvislé sítě (union-find); každá smí mít nejvýš jedny hodiny, jinak by pulsy jedněch ničily druhé.
  const uf = Int32Array.from({ length: nx * ny }, (_, k) => k);
  const hasClock = new Uint8Array(nx * ny);
  const find = (k) => {
    while (uf[k] !== k) { uf[k] = uf[uf[k]]; k = uf[k]; }
    return k;
  };
  const join = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    uf[rb] = ra;
    hasClock[ra] |= hasClock[rb];
  };

  // Obdélníkový rámeček a × b uzlů s levým horním uzlem (i0, j0); vrací buňky v pořadí oběhu nebo null.
  const placeRing = (a, b, i0, j0, clock) => {
    if (i0 + a > nx || j0 + b > ny) return null;
    for (let j = j0; j < j0 + b; j++) {
      for (let i = i0; i < i0 + a; i++) if (node[j * nx + i] !== 1) return null;
    }
    const x0 = 2 * i0 + 1, x1 = 2 * (i0 + a - 1) + 1;
    const y0 = 2 * j0 + 1, y1 = 2 * (j0 + b - 1) + 1;
    const cells = [];
    for (let x = x0; x < x1; x++) cells.push([x, y0]);
    for (let y = y0; y < y1; y++) cells.push([x1, y]);
    for (let x = x1; x > x0; x--) cells.push([x, y1]);
    for (let y = y1; y > y0; y--) cells.push([x0, y]);
    if (!cells.every(([x, y]) => mask[y * w + x])) return null;
    for (const [x, y] of cells) grid[y * w + x] = COND;
    const first = j0 * nx + i0;
    for (let j = j0; j < j0 + b; j++) {
      for (let i = i0; i < i0 + a; i++) {
        if (i === i0 || j === j0 || i === i0 + a - 1 || j === j0 + b - 1) { take(i, j); join(first, j * nx + i); }
        else node[j * nx + i] = 3;
      }
    }
    hasClock[find(first)] |= clock ? 1 : 0;
    return cells;
  };

  const ringCount = (per) => Math.max(1, Math.min(8, Math.round(allowed / per)));
  const clocks = [];
  const pins = []; // uzel každého rámečku, ze kterého vede vývod
  const addRings = (count, clock) => {
    for (let n = 0, tries = 0; n < count && tries < 60; tries++) {
      // Hodiny mají strany aspoň 5 buněk, aby elektron startoval na rovném úseku (jinak by se na rozích rozdvojil).
      const min = clock ? 3 : 2;
      const a = min + Math.floor(rand() * (5 - min));
      const b = min + Math.floor(rand() * (5 - min));
      const before = used.length;
      const cells = placeRing(a, b, Math.floor(rand() * nx), Math.floor(rand() * ny), clock);
      if (!cells) continue;
      if (clock) clocks.push(cells);
      pins.push(used[before + Math.floor(rand() * (used.length - before))]);
      n++;
    }
  };
  addRings(Math.max(2, Math.min(4, ringCount(450))), true);
  addRings(ringCount(300), false);

  // Náhodná procházka po volných uzlech, někdy se uzavře do smyčky na existující uzel.
  const walk = (si, sj, maxLen) => {
    let i = si, j = sj;
    let d = Math.floor(rand() * 4);
    let moved = 0;
    while (moved < maxLen) {
      const order = rand() < 0.7
        ? [d, ...shuffled(rand, [0, 1, 2, 3].filter((k) => k !== d))]
        : shuffled(rand, [0, 1, 2, 3]);
      let next = false;
      for (const dd of order) {
        const ni = i + DIRS[dd][0];
        const nj = j + DIRS[dd][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || node[nj * nx + ni] !== 1 || !edgeOk(i, j, dd)) continue;
        link(i, j, dd);
        take(ni, nj);
        join(j * nx + i, nj * nx + ni);
        i = ni; j = nj; d = dd; next = true;
        break;
      }
      if (!next) break;
      moved++;
      if (rand() < 0.006) {
        for (const dd of shuffled(rand, [0, 1, 2, 3])) {
          const ni = i + DIRS[dd][0];
          const nj = j + DIRS[dd][1];
          if (dd === (d + 2) % 4 || ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
          if (node[nj * nx + ni] !== 2 || !edgeOk(i, j, dd)) continue;
          const ra = find(j * nx + i), rb = find(nj * nx + ni);
          if (ra !== rb && hasClock[ra] && hasClock[rb]) continue;
          link(i, j, dd);
          join(ra, rb);
          return moved;
        }
      }
    }
    return moved;
  };

  // Každý čip a hodiny dostanou aspoň jeden vývod, ať se pulsy dostanou do sítě.
  for (const [ri, rj] of pins) walk(ri, rj, 8 + Math.floor(rand() * 20));
  for (let tries = 0; used.length < allowed * FILL && tries < 400 && used.length; tries++) {
    const [i, j] = used[Math.floor(rand() * used.length)];
    walk(i, j, 5 + Math.floor(rand() * 25));
  }

  // Elektron koluje po smyčce hodin: hlava a za ní ocas (až po vývodech, ty by je přepsaly).
  for (const cells of clocks) {
    grid[cells[2][1] * w + cells[2][0]] = HEAD;
    grid[cells[1][1] * w + cells[1][0]] = TAIL;
  }

  // Úseky pod 45°: nová buňka smí sousedit jen s předchozí buňkou cesty.
  const lonely = (x, y, px, py) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx, cy = y + dy;
        if ((dx === 0 && dy === 0) || (cx === px && cy === py)) continue;
        if (cx >= 0 && cy >= 0 && cx < w && cy < h && grid[cy * w + cx]) return false;
      }
    }
    return true;
  };
  const count = Math.round(allowed / 25);
  for (let n = 0; n < count && used.length; n++) {
    const [i, j] = used[Math.floor(rand() * used.length)];
    const sx = rand() < 0.5 ? 1 : -1;
    const sy = rand() < 0.5 ? 1 : -1;
    const want = 2 + Math.floor(rand() * 5);
    let px = 2 * i + 1, py = 2 * j + 1;
    const made = [];
    for (let k = 0; k < want; k++) {
      const x = px + sx, y = py + sy;
      if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x] || grid[y * w + x] || !lonely(x, y, px, py)) break;
      grid[y * w + x] = COND;
      made.push(y * w + x);
      px = x; py = y;
    }
    if (made.length < 2) for (const c of made) grid[c] = 0;
  }
}

export default {
  id: 'wireworld',
  group: 'automata',
  name: 'Wireworld – obvody',
  colors: 2,
  sim: {
    format: 'r8',
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 15,
    stepsPerCycle: 450, // ~30 s, pak vznikne nový obvod
    init(grid, w, h, seed, points, aspect) {
      grid.fill(0);
      generate(grid, w, h, seed, polygonMask(points, aspect, w, h));
    },
    // Klasická pravidla: hlava → ocas → vodič; vodič se sousedními 1 nebo 2 hlavami (8-okolí) → hlava.
    step(src, dst, w, h) {
      for (let y = 0; y < h; y++) {
        const y0 = y > 0 ? y - 1 : y;
        const y1 = y < h - 1 ? y + 1 : y;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = src[i];
          if (v === HEAD) dst[i] = TAIL;
          else if (v === TAIL) dst[i] = COND;
          else if (v === COND) {
            const x0 = x > 0 ? x - 1 : x;
            const x1 = x < w - 1 ? x + 1 : x;
            let n = 0;
            for (let yy = y0; yy <= y1; yy++) {
              for (let xx = x0; xx <= x1; xx++) if ((xx !== x || yy !== y) && src[yy * w + xx] === HEAD) n++;
            }
            dst[i] = n === 1 || n === 2 ? HEAD : COND;
          } else dst[i] = 0;
        }
      }
    },
  },
  glsl: `vec2 g = vLocal * uStateSize;
  vec2 p = fract(g) - 0.5;
  float aa = max(fwidth(g.x), 0.01);
  // tmavá deska s jemným šumem
  vec3 col = uColB * 0.03 + vec3(0.012) * noise(vLocal * vec2(uAspect, 1.0) * 90.0);
  if (uStateSize.x <= 0.0) return col;
  ivec2 sz = ivec2(uStateSize);
  ivec2 ci = ivec2(floor(g));
  float s[9];
  float e[9];
  bool c[9];
  for (int k = 0; k < 9; k++) {
    ivec2 q = ci + ivec2(k % 3 - 1, k / 3 - 1);
    float v = (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) ? 0.0 : texelFetch(uState, q, 0).r;
    s[k] = v;
    c[k] = v > 0.1;
    // hlava 1 → 0,55, ocas 0,55 → 0,1 (plynule podle uStateFrac), vodič svítí jen svou barvou
    e[k] = v > 0.9 ? 1.0 - 0.45 * uStateFrac : (v > 0.5 ? 0.55 - 0.45 * uStateFrac : 0.0);
  }
  vec3 headCol = mix(uColA, vec3(1.0), 0.35);
  vec3 tailCol = mix(uColB, uColA, 0.6);
  vec3 wireCol = uColB * 0.5;

  // záře elektronů do okolí
  for (int k = 0; k < 9; k++) {
    if (e[k] <= 0.0) continue;
    vec2 o = vec2(float(k % 3 - 1), float(k / 3 - 1));
    float d2 = dot(p - o, p - o);
    col += (s[k] > 0.9 ? headCol : tailCol) * e[k] * exp(-d2 * 2.4) * 0.45;
  }

  // dráty: tenké linky ke sousedním vodičům a pájecí body v uzlech
  if (c[4]) {
    float cov = 0.0;
    float links = 0.0;
    for (int k = 0; k < 9; k++) {
      if (k == 4 || !c[k]) continue;
      vec2 o = vec2(float(k % 3 - 1), float(k / 3 - 1));
      // diagonála se nekreslí, pokud ji nahrazuje cesta přes ortogonální sousedy
      if (o.x != 0.0 && o.y != 0.0 && (c[4 + int(o.x)] || c[4 + 3 * int(o.y)])) continue;
      links += 1.0;
      float tt = clamp(dot(p, o) / dot(o, o), 0.0, 0.5);
      float d = length(p - o * tt);
      cov = max(cov, 1.0 - smoothstep(0.09 - aa, 0.09 + aa, d));
    }
    float pad = 1.0 - smoothstep(0.3 - aa, 0.3 + aa, length(p));
    float dot0 = 1.0 - smoothstep(0.14 - aa, 0.14 + aa, length(p));
    float solder = links != 2.0 ? pad : dot0;
    vec3 lit = s[4] > 0.9 ? headCol : tailCol;
    vec3 base = mix(wireCol, vec3(0.85), solder * 0.3);
    vec3 wire = mix(base, lit, min(e[4] * 1.4, 1.0));
    col = mix(col, wire, max(cov, solder));
  }
  return col;`,
};
