// Přesýpací písek – „falling sand“ automat, stavová animace (`sim`). Okraje polygonu jsou stěny,
// písek se sype shora, sesouvá se do svahů a vyplní přesně tvar oblasti. Po zaplnění (~90 %) se
// oblast vyprázdní propadnutím spodem a cyklus začne znovu.
// Hodnota buňky: 0 = prázdno, 1–253 = zrnko (odstín mezi A a B), 254 = stěna.
// Mřížka má o jeden řádek víc než oblast: poslední řádek je metadata (stav musí být celý v mřížce):
// [0] fáze (0 = sypání, 1 = vyprazdňování), [1–4] seed, [5–6] počet kroků ve fázi (16 bitů).
import { gridSize, polygonMask } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const WALL = 254;
const FULL = 0.9; // podíl zaplnění, při kterém se začne vyprazdňovat
const FILL_TIMEOUT = 9000; // nejvýš tolik kroků sypání (nedosažitelné kapsy nekonvexního tvaru)
const DRAIN_CHANCE = 2; // zrnko opřené o stěnu zmizí s pravděpodobností DRAIN_CHANCE / 3

// Celočíselný hash dvou čísel (deterministický).
function hash2(a, b) {
  let x = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

export default {
  id: 'sand',
  name: 'Přesýpací písek',
  colors: 2,
  sim: {
    // Čtvercové buňky přes ohraničující obdélník oblasti, k tomu řádek metadat navíc.
    size(points, aspect) {
      const { w, h } = gridSize(points, aspect, CELLS_LONG);
      return { w, h: h + 1 };
    },
    stepsPerSecond: 90,
    stepsPerCycle: 24000,
    init(grid, w, h, seed, points, aspect) {
      const gh = h - 1;
      const mask = polygonMask(points, aspect, w, gh);
      for (let i = 0; i < w * gh; i++) grid[i] = mask[i] ? 0 : WALL;
      const m = gh * w;
      grid[m] = 0;
      for (let k = 0; k < 4; k++) grid[m + 1 + k] = (seed >>> (8 * k)) & 255;
      grid[m + 5] = 0;
      grid[m + 6] = 0;
    },
    step(src, dst, w, h, stepIndex) {
      const gh = h - 1;
      const n = w * gh;
      const m = n;
      dst.set(src);
      const seed = (src[m + 1] | (src[m + 2] << 8) | (src[m + 3] << 16) | (src[m + 4] << 24)) >>> 0;
      let phase = src[m];
      let count = src[m + 5] | (src[m + 6] << 8);
      let grains = 0;
      let open = 0;
      for (let i = 0; i < n; i++) {
        const v = src[i];
        if (v !== WALL) open++;
        if (v > 0 && v < WALL) grains++;
      }
      const salt = (seed ^ stepIndex) | 0;

      // Pohyb zdola nahoru, takže se zrnko za krok posune nejvýš o jednu buňku. Směr po řádku se střídá.
      for (let y = gh - 1; y >= 0; y--) {
        const dir = (y + stepIndex) & 1;
        for (let k = 0; k < w; k++) {
          const x = dir ? w - 1 - k : k;
          const i = y * w + x;
          const v = dst[i];
          if (v === 0 || v >= WALL) continue;
          if (y < gh - 1) {
            const b = i + w;
            if (dst[b] === 0) {
              dst[b] = v;
              dst[i] = 0;
              continue;
            }
            const first = hash2(i, salt) & 1 ? 1 : -1;
            let moved = false;
            for (let s = 0; s < 2 && !moved; s++) {
              const nx = x + (s === 0 ? first : -first);
              if (nx >= 0 && nx < w && dst[b + (nx - x)] === 0) {
                dst[b + (nx - x)] = v;
                dst[i] = 0;
                moved = true;
              }
            }
            if (moved) continue;
          }
          // Opřené zrnko při vyprazdňování mizí (propadne se).
          if (phase === 1 && (y === gh - 1 || dst[i + w] >= WALL)
            && hash2(i + 7, salt) % 3 < DRAIN_CHANCE) {
            dst[i] = 0;
            grains--;
          }
        }
      }

      if (phase === 0) {
        // Zdroje: 1–3 proudy, které se pomalu přesouvají po horní hraně masky.
        const streams = w > 100 ? 3 : w > 50 ? 2 : 1;
        const sw = Math.max(2, Math.round(w / 24));
        const drift = (seed & 255) * 0.05;
        // Odstín se pomalu mění v čase, takže vznikají vrstvy.
        const layer = 0.5 + 0.5 * Math.sin(stepIndex * 0.004 + drift);
        for (let s = 0; s < streams; s++) {
          const pos = 0.5 + 0.4 * Math.sin(stepIndex * 0.011 * (1 + 0.3 * s) + s * 2.1 + drift);
          const x0 = Math.round(pos * (w - 1)) - (sw >> 1);
          for (let d = 0; d < sw; d++) {
            const x = x0 + d;
            if (x < 0 || x >= w) continue;
            let y = 0;
            while (y < gh && src[y * w + x] === WALL) y++;
            if (y >= gh || dst[y * w + x] !== 0) continue;
            const jitter = ((hash2(x + s * 977, salt) % 100) / 100 - 0.5) * 0.3;
            const shade = Math.min(1, Math.max(0, layer + jitter));
            dst[y * w + x] = 1 + Math.round(shade * 252);
          }
        }
        if (grains >= open * FULL || count >= FILL_TIMEOUT) {
          phase = 1;
          count = 0;
        }
      } else if (grains <= 0) {
        phase = 0;
        count = 0;
      }
      dst[m] = phase;
      if (count < 65535) count++;
      dst[m + 5] = count & 255;
      dst[m + 6] = count >> 8;
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  vec2 grid = vec2(uStateSize.x, uStateSize.y - 1.0);
  vec2 g = min(vLocal * grid, grid - 0.001);
  vec2 c = floor(g);
  float v = texture(uState, (c + 0.5) / uStateSize).r;
  if (v < 0.002 || v > 0.994) return vec3(0.0);
  float shade = (v * 255.0 - 1.0) / 252.0;
  // jemná variace jasu po zrnkách a drobná mezera mezi nimi
  float lum = 0.82 + 0.18 * hash(c);
  vec2 f = abs(fract(g) - 0.5);
  float aa = max(fwidth(g.x), 0.01);
  float fill = 1.0 - smoothstep(0.5 - aa, 0.5 + aa * 0.5, max(f.x, f.y) + 0.04);
  return mix(uColA, uColB, shade) * lum * fill;`,
};
