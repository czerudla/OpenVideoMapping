// Kouř a mlha – stable fluids (Jos Stam) nad mřížkou, stavová animace (`sim`, formát rgba32f).
// Texel: R = rychlost u, G = rychlost v (buňky za krok), B = hustota kouře, A = teplota (vztlak);
// A = -1 označuje pevnou stěnu (buňka mimo polygon). Kouř stoupá (y míří dolů), víří a obtéká stěny.
// Veškerý stav je v polích src/dst, pomocné buffery níže slouží jen uvnitř jednoho volání `step`.
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 96; // buněk na delší straně oblasti
const ITERATIONS = 20; // iterací tlaku (červeno-černý Gauss-Seidel)
const BUOYANCY = 0.03; // zrychlení nahoru na jednotku teploty
const VORTICITY = 0.25; // síla vorticity confinement
const MAX_SPEED = 1.5; // omezení rychlosti (buňky za krok), drží simulaci stabilní
const DENSITY_FADE = 0.994; // rozplývání hustoty za krok
const TEMP_FADE = 0.985; // chladnutí za krok
const MAX_DENSITY = 2;
const EPOCH_STEPS = 600; // zdroje pomalu putují mezi náhodnými polohami po tolika krocích
const GUST_STEPS = 160; // délka jednoho okna pro možný poryv
const GUST_LENGTH = 40;

// Pomocné buffery (dočasná paměť jednoho volání step, zvětšují se podle potřeby).
let cap = 0;
let U, V, U2, V2, P, DIV, D, T;

function ensure(n) {
  if (n <= cap) return;
  cap = n;
  [U, V, U2, V2, P, DIV, D, T] = Array.from({ length: 8 }, () => new Float32Array(n));
}

// Deterministická hash čísla na [0, 1).
function hash(n) {
  let x = Math.imul(n | 0, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const smooth = (f) => f * f * (3 - 2 * f);

// Bilineární vzorek pole `a` (w × h) v souřadnicích buněk (střed buňky = celé číslo).
function bilerp(a, w, h, x, y) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const i = Math.min(Math.floor(x), w - 2 < 0 ? 0 : w - 2);
  const j = Math.min(Math.floor(y), h - 2 < 0 ? 0 : h - 2);
  const fx = x - i, fy = y - j;
  const i1 = w > 1 ? i + 1 : i, j1 = h > 1 ? j + 1 : j;
  const a00 = a[j * w + i], a10 = a[j * w + i1], a01 = a[j1 * w + i], a11 = a[j1 * w + i1];
  return (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;
}

// Semi-Lagrangeovská advekce: dst[i] = src vzorkované v bodě zpětně sledovaném po rychlosti (u, v).
function advect(dst, srcA, u, v, src, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dst[i] = src[i * 4 + 3] < 0 ? 0 : bilerp(srcA, w, h, x - u[i], y - v[i]);
    }
  }
}

// Vynutí nulovou normálovou rychlost u stěn a omezí velikost rychlosti.
function boundaryVelocity(u, v, src, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i * 4 + 3] < 0) { u[i] = 0; v[i] = 0; continue; }
      if (x === 0 || x === w - 1 || src[i * 4 - 1] < 0 || src[i * 4 + 7] < 0) u[i] = 0;
      if (y === 0 || y === h - 1 || src[(i - w) * 4 + 3] < 0 || src[(i + w) * 4 + 3] < 0) v[i] = 0;
      const s = Math.hypot(u[i], v[i]);
      if (s > MAX_SPEED) { u[i] *= MAX_SPEED / s; v[i] *= MAX_SPEED / s; }
    }
  }
}

// Zdroj kouře: disk o poloměru r kolem buňky (cx, cy) se směrem (dx, dy) a výkonem power.
function emit(cx, cy, dx, dy, power, w, h, src) {
  const r = 2;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const i = y * w + x;
      if (src[i * 4 + 3] < 0) continue;
      const k = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (r + 0.5)) * power;
      D[i] = Math.min(MAX_DENSITY, D[i] + 0.35 * k);
      T[i] = Math.max(T[i], 0.9 * k);
      U[i] += dx * 0.5 * k;
      V[i] += dy * 0.5 * k;
    }
  }
}

// Nejnižší (největší y) kapalná buňka sloupce nejbližšího k x; vrátí -1, pokud žádná není.
function bottomCell(src, w, h, x) {
  for (let d = 0; d < w; d++) {
    for (const xx of d === 0 ? [x] : [x - d, x + d]) {
      if (xx < 0 || xx >= w) continue;
      for (let y = h - 1; y >= 0; y--) if (src[(y * w + xx) * 4 + 3] >= 0) return y * w + xx;
    }
  }
  return -1;
}

// Kód shaderu (tělo funkce nemůže mít pomocné funkce): bilineární hustota `name` v bodě vLocal + off,
// vážená jen kapalnými buňkami (A >= 0), aby hustota nezanikala u stěn.
function sampleDensity(name, off) {
  return `float ${name};
  {
    vec2 p = (vLocal + ${off}) * sz - 0.5;
    vec2 fl = floor(p), f = p - fl;
    ivec2 hi = ivec2(sz) - 1;
    ivec2 q0 = clamp(ivec2(fl), ivec2(0), hi);
    ivec2 q1 = clamp(ivec2(fl) + 1, ivec2(0), hi);
    vec4 s00 = texelFetch(uState, ivec2(q0.x, q0.y), 0);
    vec4 s10 = texelFetch(uState, ivec2(q1.x, q0.y), 0);
    vec4 s01 = texelFetch(uState, ivec2(q0.x, q1.y), 0);
    vec4 s11 = texelFetch(uState, ivec2(q1.x, q1.y), 0);
    vec4 w4 = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y)
      * step(0.0, vec4(s00.a, s10.a, s01.a, s11.a));
    ${name} = dot(w4, vec4(s00.b, s10.b, s01.b, s11.b)) / max(w4.x + w4.y + w4.z + w4.w, 1e-4);
  }`;
}

// Projekce na nedivergentní pole: Poissonova rovnice tlaku, červeno-černý Gauss-Seidel,
// u stěn Neumannova podmínka (tlak se bere jen z kapalných sousedů).
function project(u, v, src, w, h) {
  const n = w * h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      P[i] = 0;
      DIV[i] = 0;
      if (src[i * 4 + 3] < 0) continue;
      const ur = x < w - 1 ? u[i + 1] : 0, ul = x > 0 ? u[i - 1] : 0;
      const vd = y < h - 1 ? v[i + w] : 0, vu = y > 0 ? v[i - w] : 0;
      DIV[i] = (ur - ul + vd - vu) * 0.5;
    }
  }
  for (let it = 0; it < ITERATIONS; it++) {
    for (let color = 0; color < 2; color++) {
      for (let y = 0; y < h; y++) {
        for (let x = (y + color) & 1; x < w; x += 2) {
          const i = y * w + x;
          if (src[i * 4 + 3] < 0) continue;
          let sum = 0, cnt = 0;
          if (x > 0 && src[(i - 1) * 4 + 3] >= 0) { sum += P[i - 1]; cnt++; }
          if (x < w - 1 && src[(i + 1) * 4 + 3] >= 0) { sum += P[i + 1]; cnt++; }
          if (y > 0 && src[(i - w) * 4 + 3] >= 0) { sum += P[i - w]; cnt++; }
          if (y < h - 1 && src[(i + w) * 4 + 3] >= 0) { sum += P[i + w]; cnt++; }
          P[i] = cnt ? (sum - DIV[i]) / cnt : 0;
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (src[i * 4 + 3] < 0) continue;
    const x = i % w, y = (i - x) / w;
    const pl = x > 0 && src[(i - 1) * 4 + 3] >= 0 ? P[i - 1] : P[i];
    const pr = x < w - 1 && src[(i + 1) * 4 + 3] >= 0 ? P[i + 1] : P[i];
    const pu = y > 0 && src[(i - w) * 4 + 3] >= 0 ? P[i - w] : P[i];
    const pd = y < h - 1 && src[(i + w) * 4 + 3] >= 0 ? P[i + w] : P[i];
    u[i] -= (pr - pl) * 0.5;
    v[i] -= (pd - pu) * 0.5;
  }
}

export default {
  id: 'smoke',
  name: 'Kouř',
  colors: 2,
  sim: {
    format: 'rgba32f',
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 30,
    stepsPerCycle: 30 * 3600, // restart po hodině, kdy by vznikl viditelný skok
    init(grid, w, h, seed, points, aspect) {
      const mask = polygonMask(points, aspect, w, h);
      for (let i = 0; i < w * h; i++) grid[i * 4 + 3] = mask[i] ? 0 : -1;
      // Počáteční závoj hustoty, ať není hned po spuštění prázdno.
      const rand = createRandom(seed);
      const ox = rand() * 100, oy = rand() * 100;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (mask[i]) grid[i * 4 + 2] = Math.max(0, Math.sin(x * 0.21 + ox) * Math.sin(y * 0.27 + oy)) * 0.5 * (y / h);
        }
      }
    },
    step(src, dst, w, h, stepIndex) {
      const n = w * h;
      ensure(n);
      for (let i = 0; i < n; i++) {
        const wall = src[i * 4 + 3] < 0;
        U[i] = wall ? 0 : src[i * 4];
        V[i] = wall ? 0 : src[i * 4 + 1];
        D[i] = wall ? 0 : src[i * 4 + 2];
        T[i] = wall ? 0 : src[i * 4 + 3];
      }

      // Zdroje: dvě trysky u spodního okraje, pulzující, s pomalu se měnícím směrem a polohou.
      const epoch = Math.floor(stepIndex / EPOCH_STEPS);
      const blend = smooth((stepIndex % EPOCH_STEPS) / EPOCH_STEPS);
      for (let k = 0; k < 2; k++) {
        const fx = hash(epoch * 7 + k) * (1 - blend) + hash((epoch + 1) * 7 + k) * blend;
        const c = bottomCell(src, w, h, Math.round(0.1 * (w - 1) + fx * 0.8 * (w - 1)));
        if (c < 0) continue;
        const pulse = 0.5 + 0.5 * Math.sin(stepIndex * (0.045 + 0.02 * k) + k * 2.1 + hash(epoch + k) * 6.28);
        const angle = -Math.PI / 2 + 0.55 * Math.sin(stepIndex * 0.011 + k * 1.7);
        const cy = Math.floor(c / w);
        emit(c % w, Math.max(0, cy - 1), Math.cos(angle), Math.sin(angle), 0.25 + 0.75 * pulse * pulse, w, h, src);
      }

      // Občasný poryv do strany.
      const gustWindow = Math.floor(stepIndex / GUST_STEPS);
      const inGust = stepIndex % GUST_STEPS;
      if (hash(gustWindow * 13 + 5) < 0.4 && inGust < GUST_LENGTH) {
        const dir = hash(gustWindow * 13 + 6) < 0.5 ? -1 : 1;
        const g = dir * 0.05 * Math.sin((inGust / GUST_LENGTH) * Math.PI);
        for (let i = 0; i < n; i++) if (src[i * 4 + 3] >= 0) U[i] += g;
      }

      // Vztlak a rozplývání teploty.
      for (let i = 0; i < n; i++) {
        if (src[i * 4 + 3] < 0) continue;
        V[i] -= BUOYANCY * T[i];
        T[i] *= TEMP_FADE;
      }

      // Vorticity confinement: curl do DIV, jeho velikost do P, pak síla kolmá na gradient.
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          DIV[i] = (V[i + 1] - V[i - 1] - U[i + w] + U[i - w]) * 0.5;
          P[i] = Math.abs(DIV[i]);
        }
      }
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const i = y * w + x;
          if (src[i * 4 + 3] < 0) continue;
          const gx = (P[i + 1] - P[i - 1]) * 0.5, gy = (P[i + w] - P[i - w]) * 0.5;
          const len = Math.hypot(gx, gy) + 1e-5;
          U[i] += VORTICITY * (gy / len) * DIV[i];
          V[i] -= VORTICITY * (gx / len) * DIV[i];
        }
      }
      boundaryVelocity(U, V, src, w, h);

      // Advekce rychlosti, pak projekce na nedivergentní pole.
      advect(U2, U, U, V, src, w, h);
      advect(V2, V, U, V, src, w, h);
      boundaryVelocity(U2, V2, src, w, h);
      project(U2, V2, src, w, h);
      boundaryVelocity(U2, V2, src, w, h);

      // Advekce hustoty a teploty novým polem rychlosti, zápis do dst.
      advect(U, D, U2, V2, src, w, h);
      advect(V, T, U2, V2, src, w, h);
      for (let i = 0; i < n; i++) {
        const wall = src[i * 4 + 3] < 0;
        const ok = Number.isFinite(U2[i]) && Number.isFinite(V2[i]) && Number.isFinite(U[i]) && Number.isFinite(V[i]);
        dst[i * 4] = wall || !ok ? 0 : U2[i];
        dst[i * 4 + 1] = wall || !ok ? 0 : V2[i];
        dst[i * 4 + 2] = wall || !ok ? 0 : Math.min(MAX_DENSITY, U[i] * DENSITY_FADE);
        dst[i * 4 + 3] = wall ? -1 : !ok ? 0 : Math.max(0, V[i]);
      }
    },
  },
  glsl: `vec2 sz = uStateSize;
  if (sz.x <= 0.0) return vec3(0.0);
  ${sampleDensity('d', 'vec2(0.0)')}
  ${sampleDensity('dyp', 'vec2(0.0, 1.0 / sz.y)')}
  ${sampleDensity('dym', 'vec2(0.0, -1.0 / sz.y)')}
  float gy = dyp - dym;
  float a = 1.0 - exp(-d * 2.2);
  // svit shora: povrch s hustotou rostoucí směrem dolů (y míří dolů) je osvětlený
  float lit = clamp(gy * 1.5, -1.0, 1.0);
  vec3 base = mix(uColB, uColA, smoothstep(0.1, 1.3, d));
  vec3 c = base * a * (0.8 + 0.4 * lit);
  float rim = a * (1.0 - a) * 4.0;
  c += mix(base, vec3(1.0), 0.5) * rim * 0.18;
  return clamp(c, 0.0, 1.0);`,
};
