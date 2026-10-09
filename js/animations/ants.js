// Mravenci s feromonovými stopami – stavová animace (`sim`, formát rgba8).
// Kanály buňky: R = feromon „k potravě“, G = feromon „domů“,
// B = 0 prázdno, 1–200 potrava (množství), 254 mraveniště, 255 stěna (mimo masku a okraj masky),
// A = mravenec: bit 0 přítomen, bity 1–3 směr (0–7), bit 4 nese potravu.
// Veškerý stav je v polích `src`/`dst`, nový cyklus po vyčerpání potravy se odvodí ze stavu a z `stepIndex`.
import { createRandom, gridSize, polygonMask, boundaryCells } from '../sim-utils.js';

const CELLS_LONG = 128; // buněk na delší straně oblasti
const WALL = 255;
const NEST = 254;
const FOOD_MAX = 200;
const NEST_R = 3;
const FOOD_R = 2.5;
const EVAPORATION = 0.96;
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

// Dočasná paměť jednoho volání `step` (váhy tří směrů).
const weights = new Float32Array(3);

// Všechny buňky disku o poloměru r kolem (cx, cy) leží v mřížce a nejsou stěna.
function discFree(buf, w, h, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      if (x < 0 || y < 0 || x >= w || y >= h || buf[(y * w + x) * 4 + 2] === WALL) return false;
    }
  }
  return true;
}

// Vyplní disk hodnotou kanálu B (stěny a mraveniště nepřepisuje).
function paintDisc(buf, w, h, cx, cy, r, value, rand) {
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const o = (y * w + x) * 4 + 2;
      if (buf[o] === WALL || buf[o] === NEST) continue;
      buf[o] = value === NEST ? NEST : value + Math.floor(rand() * 30);
    }
  }
}

// Naplní pole (stěny už jsou v kanálu B nastavené, vše ostatní nulové): mraveniště, zdroje potravy, mravenci.
function populate(buf, w, h, seed) {
  const rand = createRandom(seed);
  const free = [];
  for (let i = 0; i < w * h; i++) if (buf[i * 4 + 2] !== WALL) free.push(i);
  if (!free.length) return;
  const far = Math.max(w, h);
  // Náhodné místo, kde se vejde disk r a které je aspoň minDist od ostatních středů; po neúspěchu povolí kdekoliv.
  const centers = [];
  const pick = (r, minDist) => {
    let fallback = free[Math.floor(rand() * free.length)];
    for (let k = 0; k < 300; k++) {
      const i = free[Math.floor(rand() * free.length)];
      const x = i % w, y = (i - x) / w;
      if (!discFree(buf, w, h, x, y, r)) continue;
      fallback = i;
      const d = minDist * (1 - k / 300);
      if (centers.every((c) => Math.hypot(c[0] - x, c[1] - y) >= d)) { centers.push([x, y]); return [x, y]; }
    }
    const x = fallback % w, y = (fallback - x) / w;
    centers.push([x, y]);
    return [x, y];
  };
  const [nx, ny] = pick(NEST_R, 0);
  paintDisc(buf, w, h, nx, ny, NEST_R, NEST, rand);
  const sources = 2 + Math.floor(rand() * 3);
  for (let s = 0; s < sources; s++) {
    const [fx, fy] = pick(FOOD_R, 0.3 * far);
    paintDisc(buf, w, h, fx, fy, FOOD_R, 20, rand);
  }
  const count = Math.min(Math.floor(free.length / 4), 150 + Math.floor(rand() * 151));
  let placed = 0;
  for (let k = 0; k < count * 30 && placed < count; k++) {
    const i = free[Math.floor(rand() * free.length)];
    const x = i % w, y = (i - x) / w;
    if (Math.hypot(x - nx, y - ny) > 16 || buf[i * 4 + 3]) continue;
    buf[i * 4 + 3] = 1 | (Math.floor(rand() * 8) << 1);
    placed++;
  }
}

// Hodnota kanálu sousední buňky, u stěny hodnota vlastní buňky (feromon se stěnou nekončí).
function nb(src, j, c, ch) {
  return src[j * 4 + 2] === WALL ? c : src[j * 4 + ch];
}

export default {
  id: 'ants',
  name: 'Mravenci',
  colors: 2,
  sim: {
    format: 'rgba8',
    size(points, aspect) {
      return gridSize(points, aspect, CELLS_LONG);
    },
    stepsPerSecond: 15,
    stepsPerCycle: 4000,
    init(grid, w, h, seed, points, aspect) {
      const mask = polygonMask(points, aspect, w, h);
      const edge = boundaryCells(mask, w, h);
      for (let i = 0; i < w * h; i++) grid[i * 4 + 2] = mask[i] && !edge[i] ? 0 : WALL;
      populate(grid, w, h, seed);
    },
    step(src, dst, w, h, stepIndex) {
      // 1. průchod: odpařování a rozptyl feromonů, kopie potravy, těžiště mraveniště, součet potravy
      let food = 0, nestN = 0, nestX = 0, nestY = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const o = i * 4;
          const b = src[o + 2];
          dst[o + 2] = b;
          dst[o + 3] = 0;
          if (b === WALL) {
            dst[o] = 0;
            dst[o + 1] = 0;
            continue;
          }
          if (b === NEST) { nestN++; nestX += x; nestY += y; } else if (b > 0) food++;
          // okraj mřížky je vždy stěna, takže sousedé aktivní buňky leží v mřížce
          for (let ch = 0; ch < 2; ch++) {
            const c = src[o + ch];
            const sum = nb(src, i - 1, c, ch) + nb(src, i + 1, c, ch) + nb(src, i - w, c, ch) + nb(src, i + w, c, ch);
            dst[o + ch] = ((c * 8 + sum) / 12) * EVAPORATION;
          }
        }
      }
      if (nestN) { nestX /= nestN; nestY /= nestN; }
      if (food === 0) {
        // všechny zdroje vyčerpány: nový cyklus se stejnými stěnami
        for (let i = 0; i < w * h; i++) {
          dst[i * 4] = 0;
          dst[i * 4 + 1] = 0;
          dst[i * 4 + 2] = src[i * 4 + 2] === WALL ? WALL : 0;
          dst[i * 4 + 3] = 0;
        }
        populate(dst, w, h, Math.imul(stepIndex + 1, 0x9e3779b1) ^ Math.imul(nestX * 131 + nestY * 7 + 1, 0x85ebca6b));
        return;
      }
      // 2. průchod: pohyb mravenců v pořadí buněk
      const rand = createRandom(Math.imul(stepIndex + 1, 0x9e3779b1) ^ Math.imul(nestX * 131 + nestY * 7 + 1, 0x85ebca6b));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const a = src[o + 3];
          if (!(a & 1)) continue;
          const dir = (a >> 1) & 7;
          let carry = (a >> 4) & 1;
          // váhy směrů vlevo, vpřed, vpravo: základ, feromon, čich (potrava / mraveniště), u nosiče směr k mraveništi
          let total = 0;
          for (let k = 0; k < 3; k++) {
            const nd = (dir + k + 7) & 7;
            const t = (y + DY[nd]) * w + x + DX[nd];
            const tb = src[t * 4 + 2];
            let wgt = 0;
            if (tb !== WALL) {
              wgt = 0.3 + (12 * src[t * 4 + (carry ? 1 : 0)]) / 255;
              if (carry) {
                const len = Math.hypot(nestX - x, nestY - y) || 1;
                wgt += 3 * Math.max(0, ((nestX - x) * DX[nd] + (nestY - y) * DY[nd]) / (len * Math.hypot(DX[nd], DY[nd])));
                if (tb === NEST) wgt += 20;
              } else if (tb > 0 && tb <= FOOD_MAX) wgt += 20;
              if (k === 1) wgt *= 2;
            }
            weights[k] = wgt;
            total += wgt;
          }
          let nd;
          if (total <= 0) {
            // zablokovaný: otočí se zhruba zpět
            nd = (dir + 3 + Math.floor(rand() * 3)) & 7;
          } else {
            let r = rand() * total;
            let k = 0;
            while (k < 2 && r >= weights[k]) { r -= weights[k]; k++; }
            nd = (dir + k + 7) & 7;
          }
          let px = x, py = y;
          let d = nd;
          if (total > 0) {
            const tx = x + DX[nd], ty = y + DY[nd];
            const t = ty * w + tx;
            if (!dst[t * 4 + 3] && !src[t * 4 + 3]) {
              px = tx;
              py = ty;
              const tb = src[t * 4 + 2];
              if (!carry && tb > 0 && tb <= FOOD_MAX) {
                dst[t * 4 + 2] = tb - 1;
                carry = 1;
                d = (nd + 4) & 7;
              } else if (carry && tb === NEST) {
                carry = 0;
                d = (nd + 4) & 7;
              }
            }
          }
          const po = (py * w + px) * 4;
          dst[po + 3] = 1 | (d << 1) | (carry << 4);
          // stopa: nosič značí cestu k potravě, hledající domovskou stopu slábnoucí se vzdáleností od mraveniště
          if (carry) dst[po] = Math.min(255, dst[po] + 40);
          else dst[po + 1] = Math.min(255, dst[po + 1] + Math.max(20, 130 - 2 * Math.hypot(px - nestX, py - nestY)));
        }
      }
    },
  },
  glsl: `if (uStateSize.x <= 0.0) return vec3(0.0);
  vec2 g = vLocal * uStateSize;
  ivec2 hi = ivec2(uStateSize) - 1;
  ivec2 cell = clamp(ivec2(floor(g)), ivec2(0), hi);
  vec2 p = g - 0.5;
  vec2 i0 = floor(p), f = p - i0;
  ivec2 a = clamp(ivec2(i0), ivec2(0), hi);
  ivec2 b = clamp(ivec2(i0) + 1, ivec2(0), hi);
  vec4 s00 = texelFetch(uState, a, 0);
  vec4 s10 = texelFetch(uState, ivec2(b.x, a.y), 0);
  vec4 s01 = texelFetch(uState, ivec2(a.x, b.y), 0);
  vec4 s11 = texelFetch(uState, b, 0);
  vec4 sm = mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);

  // feromonové stopy: měkká záře, stopa k potravě výraznější než domovská
  vec3 col = uColA * min(1.0, pow(sm.r, 0.6) * 0.95 + pow(sm.g, 0.6) * 0.3);

  // mraveniště: kruh vyhlazený z okolních buněk
  float n00 = step(253.5, s00.b * 255.0) * step(s00.b * 255.0, 254.5);
  float n10 = step(253.5, s10.b * 255.0) * step(s10.b * 255.0, 254.5);
  float n01 = step(253.5, s01.b * 255.0) * step(s01.b * 255.0, 254.5);
  float n11 = step(253.5, s11.b * 255.0) * step(s11.b * 255.0, 254.5);
  float m = mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
  float fill = smoothstep(0.4, 0.6, m);
  float rim = fill * (1.0 - smoothstep(0.6, 0.9, m));
  col += mix(uColA, vec3(1.0), 0.3) * (0.2 * fill + 0.6 * rim);

  // potrava: zrnité shluky, řídnoucí s ubývajícím množstvím
  vec4 c = texelFetch(uState, cell, 0);
  float amt = c.b * 255.0;
  if (amt > 0.5 && amt < 200.5) {
    vec2 gp = g * 3.0;
    float lit = step(hash(floor(gp)), clamp(amt / 45.0, 0.15, 1.0) * 0.75);
    float grain = lit * (1.0 - smoothstep(0.25, 0.4, length(fract(gp) - 0.5)));
    col = mix(col, uColB * (0.7 + 0.3 * hash(floor(gp) + 3.0)), grain);
  }

  // mravenci: drobné jasné body, nosič potravy má barvu potravy
  float ant = c.a * 255.0;
  if (ant > 0.5) {
    float spot = 1.0 - smoothstep(0.2, 0.32, length(fract(g) - 0.5));
    col = mix(col, ant > 15.5 ? uColB : vec3(1.0), spot);
  }
  return min(col, vec3(1.0));`,
};
