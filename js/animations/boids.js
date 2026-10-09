// Hejno (boids) – model Craiga Reynoldse: každý pták dodržuje odstup, srovnává směr se sousedy a drží se hejna.
// Stavová animace (`sim`, rgba32f), 96 agentů. Řádek 0 = agenti (x, y, vx, vy), řádek 1 = parametry,
// řádky 2+ = hrubá mapa vzdálenosti k okraji tvaru (sdf, nx, ny), podle které se ptáci okrajům vyhýbají.
// Souřadnice jsou v prostoru se zachovaným poměrem stran s počátkem v rohu ohraničujícího obdélníku, rychlost je za krok.
// Parametry (řádek 1): texel 0 = (počátek x, y, šířka, výška), texel 1 = predátor (x, y, zbývající kroky),
// texel 2 = (delší strana Lm, šířka mapy, výška mapy).
import { createRandom, gridSize, polygonMask } from '../sim-utils.js';

const N = 96; // počet ptáků (= šířka textury)
const FIELD_LONG = 48; // buněk mapy vzdálenosti na delší straně oblasti
const STEPS_PER_SECOND = 30;
const EVENT_PERIOD = 300; // jednou za 10 s (s náhodným posunem) se hejno leknutím rozprskne
const SCARE_STEPS = 24;

// Parametry v násobcích delší strany oblasti Lm.
const VISION = 0.16;
const SEPARATION = 0.045;
const MAX_SPEED = 0.011;
const MIN_SPEED = 0.005;
const MAX_FORCE = 0.0007;
const MARGIN = 0.1; // od této vzdálenosti od okraje se pták začne odklánět
const WALL = 0.025; // blíž k okraji se pták nikdy nedostane
const SCARE_RADIUS = 0.35;

// Dočasná paměť, kterou `init` a `sample` používají jen v rámci jednoho volání (žádný stav simulace).
const maskBuf = new Uint8Array(FIELD_LONG * FIELD_LONG);
const samp = new Float32Array(3);

function hash32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

// Bilineární vzorek mapy okraje v bodě (x, y) do `samp` = (vzdálenost, nx, ny); vzdálenost je uvnitř kladná.
function sample(arr, w, fw, fh, sx, sy, x, y) {
  const gx = Math.min(Math.max(x / sx * fw - 0.5, 0), fw - 1);
  const gy = Math.min(Math.max(y / sy * fh - 0.5, 0), fh - 1);
  const i0 = Math.min(Math.floor(gx), fw - 1), j0 = Math.min(Math.floor(gy), fh - 1);
  const i1 = Math.min(i0 + 1, fw - 1), j1 = Math.min(j0 + 1, fh - 1);
  const fx = gx - i0, fy = gy - j0;
  const a = ((2 + j0) * w + i0) * 4, b = ((2 + j0) * w + i1) * 4;
  const c = ((2 + j1) * w + i0) * 4, d = ((2 + j1) * w + i1) * 4;
  for (let k = 0; k < 3; k++) {
    samp[k] = (arr[a + k] * (1 - fx) + arr[b + k] * fx) * (1 - fy) + (arr[c + k] * (1 - fx) + arr[d + k] * fx) * fy;
  }
}

export default {
  id: 'boids',
  name: 'Hejno',
  colors: 2,
  sim: {
    format: 'rgba32f',
    size(points, aspect) {
      return { w: N, h: 2 + gridSize(points, aspect, FIELD_LONG).h };
    },
    stepsPerSecond: STEPS_PER_SECOND,
    stepsPerCycle: STEPS_PER_SECOND * 200,
    init(arr, w, h, seed, points, aspect) {
      const { w: fw, h: fh } = gridSize(points, aspect, FIELD_LONG);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [px, py] of points) {
        x0 = Math.min(x0, px * aspect); x1 = Math.max(x1, px * aspect);
        y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      const sx = Math.max(x1 - x0, 1e-6), sy = Math.max(y1 - y0, 1e-6);
      const lm = Math.max(sx, sy);
      const row1 = w * 4;
      arr[row1] = x0; arr[row1 + 1] = y0; arr[row1 + 2] = sx; arr[row1 + 3] = sy;
      arr[row1 + 8] = lm; arr[row1 + 9] = fw; arr[row1 + 10] = fh;

      // Mapa vzdálenosti: přesná vzdálenost středu buňky k nejbližší hraně se znaménkem podle masky.
      polygonMask(points, aspect, fw, fh, maskBuf);
      const n = points.length;
      for (let j = 0; j < fh; j++) {
        for (let i = 0; i < fw; i++) {
          const qx = ((i + 0.5) / fw) * sx, qy = ((j + 0.5) / fh) * sy;
          let best = Infinity;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const ax = points[a][0] * aspect - x0, ay = points[a][1] - y0;
            const ex = points[b][0] * aspect - x0 - ax, ey = points[b][1] - y0 - ay;
            const wx = qx - ax, wy = qy - ay;
            const k = Math.min(Math.max((wx * ex + wy * ey) / Math.max(ex * ex + ey * ey, 1e-12), 0), 1);
            const dx = wx - ex * k, dy = wy - ey * k;
            best = Math.min(best, dx * dx + dy * dy);
          }
          arr[((2 + j) * w + i) * 4] = (maskBuf[j * fw + i] ? 1 : -1) * Math.sqrt(best);
        }
      }
      // Normála = směr růstu vzdálenosti (dovnitř), z centrálních diferencí mapy.
      for (let j = 0; j < fh; j++) {
        for (let i = 0; i < fw; i++) {
          const l = ((2 + j) * w + Math.max(i - 1, 0)) * 4, r = ((2 + j) * w + Math.min(i + 1, fw - 1)) * 4;
          const u = ((2 + Math.max(j - 1, 0)) * w + i) * 4, d = ((2 + Math.min(j + 1, fh - 1)) * w + i) * 4;
          const gx = arr[r] - arr[l], gy = arr[d] - arr[u];
          const len = Math.hypot(gx, gy);
          const o = ((2 + j) * w + i) * 4;
          arr[o + 1] = len > 1e-9 ? gx / len : 0;
          arr[o + 2] = len > 1e-9 ? gy / len : 0;
        }
      }

      // Ptáci začínají jako hejno kolem místa uvnitř tvaru, které je co nejdál od okraje.
      const rand = createRandom(seed);
      let cx = sx / 2, cy = sy / 2, cs = -Infinity;
      for (let t = 0; t < 200; t++) {
        const px = rand() * sx, py = rand() * sy;
        sample(arr, w, fw, fh, sx, sy, px, py);
        const s = Math.min(samp[0], 0.25 * lm);
        if (s > cs) { cs = s; cx = px; cy = py; }
      }
      const sp0 = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * 0.5) * lm;
      for (let i = 0; i < N; i++) {
        let px = cx, py = cy;
        for (let t = 0; t < 20; t++) {
          const qx = cx + (rand() + rand() + rand() - 1.5) * 0.16 * lm;
          const qy = cy + (rand() + rand() + rand() - 1.5) * 0.16 * lm;
          sample(arr, w, fw, fh, sx, sy, qx, qy);
          if (qx >= 0 && qx <= sx && qy >= 0 && qy <= sy && samp[0] > MARGIN * lm) { px = qx; py = qy; break; }
        }
        const ang = rand() * Math.PI * 2;
        arr[i * 4] = px; arr[i * 4 + 1] = py;
        arr[i * 4 + 2] = Math.cos(ang) * sp0; arr[i * 4 + 3] = Math.sin(ang) * sp0;
      }
    },
    step(src, dst, w, h, stepIndex) {
      // Parametry a mapa okraje se nemění, jen se přenesou do druhého pole.
      const row1 = w * 4;
      dst.set(src.subarray(row1), row1);
      const sx = src[row1 + 2], sy = src[row1 + 3];
      const lm = src[row1 + 8], fw = src[row1 + 9], fh = src[row1 + 10];
      const vision = VISION * lm, sep = SEPARATION * lm, vmax = MAX_SPEED * lm, vmin = MIN_SPEED * lm;
      const fmax = MAX_FORCE * lm, margin = MARGIN * lm, wall = WALL * lm;
      const scareR = SCARE_RADIUS * lm;
      const left = src[row1 + 6];
      const pdx = src[row1 + 4], pdy = src[row1 + 5];
      if (left > 0) dst[row1 + 6] = left - 1;

      for (let i = 0; i < N; i++) {
        const o = i * 4;
        const x = src[o], y = src[o + 1];
        let vx = src[o + 2], vy = src[o + 3];
        let sepx = 0, sepy = 0, avx = 0, avy = 0, cohx = 0, cohy = 0, cnt = 0;
        for (let j = 0; j < N; j++) {
          if (j === i) continue;
          const dx = src[j * 4] - x, dy = src[j * 4 + 1] - y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= vision * vision) continue;
          cnt++;
          avx += src[j * 4 + 2]; avy += src[j * 4 + 3];
          cohx += dx; cohy += dy;
          if (d2 < sep * sep && d2 > 1e-12) {
            const d = Math.sqrt(d2);
            const k = (1 - d / sep) / d;
            sepx -= dx * k; sepy -= dy * k;
          }
        }
        // Odstup, zarovnání směru a soudržnost.
        let fx = sepx * 1.5 * fmax, fy = sepy * 1.5 * fmax;
        if (cnt > 0) {
          fx += (avx / cnt - vx) * 0.1;
          fy += (avy / cnt - vy) * 0.1;
          const cl = Math.hypot(cohx, cohy);
          if (cl > 1e-12) {
            const k = Math.min(cl / cnt / vision, 1) * 0.6 * fmax / cl;
            fx += cohx * k; fy += cohy * k;
          }
        }
        // Leknutí: dočasné odpuzování od místa „predátora“.
        if (left > 0) {
          const dx = x - pdx, dy = y - pdy;
          const d = Math.hypot(dx, dy);
          if (d < scareR) {
            const k = (1 - d / scareR) * 3 * fmax / Math.max(d, 1e-9);
            fx += dx * k; fy += dy * k;
          }
        }
        const fl = Math.hypot(fx, fy);
        if (fl > 2 * fmax) { fx *= 2 * fmax / fl; fy *= 2 * fmax / fl; }
        // Okraj: odpudivá síla podle vzdálenosti v aktuální poloze a o kus dopředu po směru letu.
        sample(src, w, fw, fh, sx, sy, x, y);
        let ws = samp[0], wnx = samp[1], wny = samp[2];
        sample(src, w, fw, fh, sx, sy, x + vx * 10, y + vy * 10);
        if (samp[0] < ws) { ws = samp[0]; wnx = samp[1]; wny = samp[2]; }
        if (ws < margin) {
          const push = (margin - ws) / margin;
          fx += wnx * 3 * fmax * push; fy += wny * 3 * fmax * push;
        }
        vx += fx; vy += fy;
        const sp = Math.hypot(vx, vy);
        if (sp > vmax) {
          vx *= vmax / sp; vy *= vmax / sp;
        } else if (sp < vmin) {
          if (sp > 1e-9) { vx *= vmin / sp; vy *= vmin / sp; } else { vx = vmin; vy = 0; }
        }
        // Pojistka: pták se nikdy nedostane blíž k okraji než `wall` ani mimo ohraničující obdélník.
        let nx = Math.min(Math.max(x + vx, 0), sx), ny = Math.min(Math.max(y + vy, 0), sy);
        sample(src, w, fw, fh, sx, sy, nx, ny);
        if (samp[0] < wall) {
          const push = wall - samp[0];
          nx = Math.min(Math.max(nx + samp[1] * push, 0), sx);
          ny = Math.min(Math.max(ny + samp[2] * push, 0), sy);
          const dn = vx * samp[1] + vy * samp[2];
          if (dn < 0) { vx -= 1.5 * dn * samp[1]; vy -= 1.5 * dn * samp[2]; }
        }
        dst[o] = nx; dst[o + 1] = ny; dst[o + 2] = vx; dst[o + 3] = vy;
      }

      // Občas se predátor objeví uprostřed hejna a ptáci se rozprchnou.
      const k = Math.floor(stepIndex / EVENT_PERIOD);
      if (stepIndex % EVENT_PERIOD === 150 + hash32(k + 1) % 100) {
        let cx = 0, cy = 0;
        for (let i = 0; i < N; i++) { cx += dst[i * 4]; cy += dst[i * 4 + 1]; }
        dst[row1 + 4] = cx / N; dst[row1 + 5] = cy / N; dst[row1 + 6] = SCARE_STEPS;
      }
    },
  },
  glsl: `const int MAX_AGENTS = 96;
  vec2 A = vec2(uAspect, 1.0);
  vec3 bg = mix(uColA, uColB, 0.5 * (vLocal.x + vLocal.y)) * (0.04 + 0.06 * vLocal.y);
  if (uStateSize.x < 1.0) return bg;

  vec4 par = texelFetch(uState, ivec2(0, 1), 0);
  vec2 q = vUV * A - par.xy;
  float Lm = max(par.z, par.w);
  float L = 0.016 * Lm;
  float W = 0.55 * L;
  float px = max(fwidth(q.y), 1e-5);
  float reach = 7.5 * L;

  vec3 col = bg;
  for (int i = 0; i < MAX_AGENTS; i++) {
    if (i >= int(uStateSize.x)) break;
    vec4 a = texelFetch(uState, ivec2(i, 0), 0);
    vec2 d = q - (a.xy + a.zw * uStateFrac);
    if (max(abs(d.x), abs(d.y)) > reach) continue;
    float spd = length(a.zw);
    vec2 dir = spd > 1e-9 ? a.zw / spd : vec2(1.0, 0.0);
    float sf = clamp((spd / Lm - 0.005) / 0.006, 0.0, 1.0);
    float u = dot(d, dir);
    float v = abs(dot(d, vec2(-dir.y, dir.x)));
    vec3 c = mix(uColA, uColB, clamp(0.6 * hash(vec2(float(i), 1.0)) + 0.4 * sf, 0.0, 1.0));

    // Tělo: šipka se špičkou vpředu a výřezem vzadu.
    float e = W * (L - u) / (1.6 * L) - v;
    float notch = u + 0.6 * L - 0.35 * L * (1.0 - v / W);
    float body = clamp(e / px + 0.5, 0.0, 1.0) * clamp(notch / px + 0.5, 0.0, 1.0) * clamp((u + 0.6 * L) / px + 0.5, 0.0, 1.0);
    col = max(col, c * body);

    // Slábnoucí ocas, delší u rychlejších ptáků.
    float T = L * (1.5 + 5.0 * sf);
    float tt = (-u - 0.3 * L) / T;
    if (tt > 0.0 && tt < 1.0) {
      float tail = clamp((0.2 * W * (1.0 - tt) - v) / px + 0.5, 0.0, 1.0) * (1.0 - tt) * 0.5;
      col = max(col, c * tail);
    }
  }
  return col;`,
};
