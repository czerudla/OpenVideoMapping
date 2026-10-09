// Vodní hladina – kapky vytvářejí kruhové vlny, které se šíří, interferují a odrážejí od okrajů tvaru oblasti.
// Stavová animace (`sim`, rgba32f): R = výška hladiny, G = předchozí výška, B = maska oblasti (1 uvnitř),
// A = seed cyklu (kapky jsou odvozené z `stepIndex`, takže stav zůstává deterministický).
import { gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const DAMPING = 0.995; // tlumení za krok, vlny vydrží několik odrazů
const LIMIT = 10; // pojistka proti explozi výšky
const DROP_CHANCE = 0.025; // pravděpodobnost kapky za krok v klidu
const RAIN_CHANCE = 0.08; // pravděpodobnost kapky za krok během deště
const RAIN_WINDOW = 360; // délka okna, ve kterém se rozhoduje o dešti (kroky)
const RAIN_PROBABILITY = 0.25;

// Deterministický hash (a, b) -> [0, 1).
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Gaussovský důlek o poloměru sigma buněk se středem v buňce (cx, cy), jen uvnitř masky.
function addDrop(dst, w, h, cx, cy, sigma, amp) {
  const r = Math.ceil(sigma * 3);
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const i = (y * w + x) * 4;
      if (dst[i + 2] < 0.5) continue;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      dst[i] += amp * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
}

// Najde buňku uvnitř masky a vloží do ní kapku; kind 1 = velká, jinak malá.
function drop(dst, w, h, seed, key, kind) {
  for (let k = 0; k < 12; k++) {
    const x = Math.floor(hash2(seed, key * 31 + k * 2) * w);
    const y = Math.floor(hash2(seed, key * 31 + k * 2 + 1) * h);
    if (dst[(y * w + x) * 4 + 2] < 0.5) continue;
    if (kind === 1) addDrop(dst, w, h, x, y, 2.4, -3);
    else addDrop(dst, w, h, x, y, 1.3, -1.2 - hash2(seed, key * 31 + 29) * 0.8);
    return;
  }
}

export default {
  id: 'ripples',
  name: 'Vodní hladina',
  colors: 2,
  sim: {
    format: 'rgba32f',
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 60,
    stepsPerCycle: 7200,
    init(grid, w, h, seed, points, aspect) {
      const mask = polygonMask(points, aspect, w, h);
      for (let i = 0; i < w * h; i++) {
        grid[i * 4 + 2] = mask[i];
        grid[i * 4 + 3] = seed & 0xffffff;
      }
      drop(grid, w, h, seed & 0xffffff, 0, 1);
      for (let i = 0; i < w * h; i++) grid[i * 4 + 1] = grid[i * 4];
    },
    step(src, dst, w, h, stepIndex) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          dst[i + 2] = src[i + 2];
          dst[i + 3] = src[i + 3];
          dst[i + 1] = src[i];
          if (src[i + 2] < 0.5) {
            dst[i] = 0;
            continue;
          }
          // Mimo masku a mimo mřížku je výška 0 (odraz od okraje).
          const l = x > 0 ? src[i - 4] : 0;
          const r = x < w - 1 ? src[i + 4] : 0;
          const u = y > 0 ? src[i - w * 4] : 0;
          const d = y < h - 1 ? src[i + w * 4] : 0;
          let v = ((l + r + u + d) * 0.5 - src[i + 1]) * DAMPING;
          if (!(v > -LIMIT)) v = -LIMIT; // zachytí i NaN
          else if (v > LIMIT) v = LIMIT;
          dst[i] = v;
        }
      }
      const seed = src[3];
      // Déšť: v některých oknech jsou kapky mnohem častější.
      const raining = hash2(seed, 100000 + Math.floor(stepIndex / RAIN_WINDOW)) < RAIN_PROBABILITY;
      const chance = raining ? RAIN_CHANCE : DROP_CHANCE;
      if (hash2(seed, stepIndex * 2) < chance) {
        drop(dst, w, h, seed, stepIndex + 1, hash2(seed, stepIndex * 2 + 1) < 0.12 ? 1 : 0);
      }
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  // Okolí 4×4 buněk, z něj se bilineárně interpoluje výška i její gradient (hladký obraz bez viditelných buněk).
  vec2 p = vLocal * uStateSize - 0.5;
  vec2 ip = floor(p);
  vec2 f = p - ip;
  ivec2 hi = ivec2(uStateSize) - 1;
  float H[16];
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      ivec2 c = clamp(ivec2(ip) + ivec2(i - 1, j - 1), ivec2(0), hi);
      H[j * 4 + i] = texelFetch(uState, c, 0).r;
    }
  }
  vec2 g[4];
  float hh[4];
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      int k = (j + 1) * 4 + (i + 1);
      g[j * 2 + i] = 0.5 * vec2(H[k + 1] - H[k - 1], H[k + 4] - H[k - 4]);
      hh[j * 2 + i] = H[k];
    }
  }
  vec2 grad = mix(mix(g[0], g[1], f.x), mix(g[2], g[3], f.x), f.y);
  float height = mix(mix(hh[0], hh[1], f.x), mix(hh[2], hh[3], f.x), f.y);

  vec3 n = normalize(vec3(-grad * 1.2, 1.0));
  // Dno: světlé kaustické pruhy zkreslené sklonem hladiny.
  vec2 q = vLocal * vec2(uAspect, 1.0) * 5.0 + n.xy * 1.2;
  float c1 = 1.0 - abs(noise(q + vec2(t * 0.05, t * 0.03)) * 2.0 - 1.0);
  float c2 = 1.0 - abs(noise(q * 1.7 - vec2(t * 0.04, -t * 0.06)) * 2.0 - 1.0);
  float caustic = pow(c1 * c2, 3.0);
  vec3 col = uColB * (0.35 + 0.35 * noise(q * 0.6) + 0.12 * height);
  col += uColA * caustic * 0.35;
  // Odlesk na hřebenech vln.
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  vec3 Hv = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hv), 0.0), 90.0);
  float sheen = smoothstep(0.1, 0.8, length(grad)) * 0.3;
  col += uColA * (spec * 1.4 + sheen);
  return clamp(col, 0.0, 1.0);`,
};
