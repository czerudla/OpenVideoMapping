// Breakout – oblast je vyplněná cihlami ve svém tvaru, míček je rozbíjí a pálka dole hraje sama (stavová animace `sim`).
// Texturu (r8, šířka w) tvoří vrstva buněk (w × Lh řádků) a za ní řádky s metadaty:
// buňka 0 = prázdno, 1–200 = cihla (řada + 1), 201 = mimo polygon (zeď), 240–255 = záblesk rozbité cihly (255 čerstvě rozbitá);
// metadata (lineárně od začátku řádku za vrstvou): míček x, y (16 bit, 1/256 buňky), jeho rychlost, pálka x, režim hry,
// časovač, stav generátoru náhodných čísel, záměr minutí a spodní řádek každého sloupce (kam až smí pálka).
// Buňka je široká 2 a vysoká 1 (poměr 2:1), proto je vodorovná rychlost v buňkách poloviční než svislá.
import { polygonMask } from '../sim-utils.js';

const COLS = 24; // sloupců cihel
const MAX_LAYER_H = 100; // nejvíc řádků vrstvy buněk (u úzkých vysokých tvarů se zužuje počet sloupců)
const MIN_LAYER_H = 6;
const BRICK_ZONE = 0.6; // cihly jsou v horních 60 % výšky
const META = 16; // bajtů metadat před spodními řádky sloupců
const WALL = 201;
const FLASH_MIN = 240;
const FLASH_FADE = 4;
const MAX_BRICK = 200;
const NONE = 255; // sloupec bez místa pro pálku

// Offsety v metadatech.
const BX = 0, BY = 2, VX = 4, VY = 5, PX = 6, MODE = 8, TIMER = 9, RNG = 10, AIM = 14, MISS = 15;
// Režimy: 0 podání (míček sedí na pálce), 1 hra, 2 aut (míček zmizel), 3 blikání po vyčištění / na konci cyklu.
const SERVE = 0, PLAY = 1, OUT = 2, CLEAR = 3;

const HX = 51; // poloviční rozměry míčku v 1/256 buňky (čtverec 0,8 × 0,8 výšky buňky)
const HY = 102;
const SPEED = 120; // svislá rychlost míčku v 1/256 buňky za krok
const MAX_SIDE = 0.85; // nejvyšší podíl rychlosti, který odraz od pálky přidá do vodorovného směru
const PAD_TOP = 26; // horní hrana pálky uvnitř buňky
const PAD_SPEED = 70;
const MISS_CHANCE = 0.12;
const SERVE_STEPS = 24;
const OUT_STEPS = 30;
const BLINK_STEPS = 30;
const STEPS_PER_SECOND = 60;
const STEPS_PER_CYCLE = STEPS_PER_SECOND * 90;

const metaRows = (w) => Math.ceil((META + w) / w);
const brickRows = (lh) => Math.max(1, Math.floor(lh * BRICK_ZONE));
// Poloviční šířka pálky v buňkách, stejný vzorec je ve shaderu.
const padHalf = (w) => Math.min(Math.max(1.5, w * 0.1), w * 0.5);

function rand(g, o) {
  let s = ((g[o + RNG] << 24) | (g[o + RNG + 1] << 16) | (g[o + RNG + 2] << 8) | g[o + RNG + 3]) | 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  g[o + RNG] = s >>> 24;
  g[o + RNG + 1] = (s >>> 16) & 255;
  g[o + RNG + 2] = (s >>> 8) & 255;
  g[o + RNG + 3] = s & 255;
  return (s >>> 0) / 4294967296;
}

const get16 = (g, i) => (g[i] << 8) | g[i + 1];
function set16(g, i, v) {
  g[i] = v >> 8;
  g[i + 1] = v & 255;
}

// Rozsah sloupců, kde se pálka smí pohybovat, nebo null.
function freeRange(g, o, w) {
  let first = -1, last = -1;
  for (let c = 0; c < w; c++) {
    if (g[o + META + c] !== NONE) {
      if (first < 0) first = c;
      last = c;
    }
  }
  return first < 0 ? null : [first, last];
}

// Pálka a míček na startu podání.
function placeServe(g, o, w, padX) {
  const col = Math.min(w - 1, Math.max(0, padX >> 8));
  const row = g[o + META + col];
  set16(g, o + PX, padX);
  set16(g, o + BX, padX);
  set16(g, o + BY, row === NONE ? 0 : row * 256 + PAD_TOP - HY - 1);
  g[o + VX] = 128;
  g[o + VY] = 128;
}

// Zasáhne míček (box o středu px, py) zeď nebo cihlu? Zasažené cihle se nastaví záblesk.
function hitBox(g, w, lh, px, py, breakBricks) {
  let hit = false;
  for (let k = 0; k < 4; k++) {
    const x = (k & 1 ? px + HX : px - HX) >> 8;
    const y = (k & 2 ? py + HY : py - HY) >> 8;
    if (x < 0 || y < 0 || x >= w || y >= lh) {
      hit = true;
      continue;
    }
    const v = g[y * w + x];
    if (v === 0 || v >= FLASH_MIN) continue;
    hit = true;
    if (v !== WALL && breakBricks) g[y * w + x] = 255;
  }
  return hit;
}

// Vrátí všechny cihly na původní místa (podle masky polygonu a pásma cihel).
function restoreBricks(g, w, lh) {
  const rows = brickRows(lh);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (g[i] !== WALL) g[i] = Math.min(y, MAX_BRICK - 1) + 1;
    }
  }
}

function bounceOffPaddle(g, o, w, bx, padX, hw) {
  const off = Math.max(-1, Math.min(1, (bx - padX) / hw));
  const vxp = off * MAX_SIDE * SPEED;
  let vx = Math.round(vxp / 2);
  if (Math.abs(vx) < 8) vx = (vx < 0 || (vx === 0 && rand(g, o) < 0.5)) ? -8 : 8;
  g[o + VX] = 128 + vx;
  g[o + VY] = 128 - Math.round(Math.sqrt(SPEED * SPEED - vxp * vxp));
  // Nový záměr: kam na pálku míček dopadne a jestli ho pálka tentokrát mine.
  g[o + AIM] = 128 + Math.round((rand(g, o) * 2 - 1) * 0.8 * 127);
  g[o + MISS] = rand(g, o) < MISS_CHANCE ? 1 : 0;
}

export default {
  id: 'breakout',
  group: 'games',
  name: 'Breakout',
  colors: 2,
  sim: {
    format: 'r8',
    size(points, aspect) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of points) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const bw = Math.max((x1 - x0) * aspect, 1e-3);
      const bh = Math.max(y1 - y0, 1e-3);
      // Cihla je 2:1, takže výška buněk vychází z poměru stran ohraničujícího obdélníku.
      let w = COLS;
      if (2 * w * bh / bw > MAX_LAYER_H) w = Math.max(4, Math.floor(MAX_LAYER_H * bw / (2 * bh)));
      const lh = Math.max(MIN_LAYER_H, Math.min(MAX_LAYER_H, Math.round(2 * w * bh / bw)));
      return { w, h: lh + metaRows(w) };
    },
    stepsPerSecond: STEPS_PER_SECOND,
    stepsPerCycle: STEPS_PER_CYCLE,
    init(grid, w, h, seed, points, aspect) {
      const lh = h - metaRows(w);
      const o = w * lh;
      polygonMask(points, aspect, w, lh, grid);
      const rows = brickRows(lh);
      for (let i = 0; i < w * lh; i++) grid[i] = grid[i] ? 0 : WALL;
      restoreBricks(grid, w, lh);
      // Spodní řádek sloupce = nejníž položená buňka uvnitř polygonu, ale jen mimo pásmo cihel.
      for (let c = 0; c < w; c++) {
        let row = NONE;
        for (let y = lh - 1; y >= rows; y--) {
          if (grid[y * w + c] !== WALL) { row = y; break; }
        }
        grid[o + META + c] = row;
      }
      const s = (seed | 1) >>> 0;
      grid[o + RNG] = s >>> 24;
      grid[o + RNG + 1] = (s >>> 16) & 255;
      grid[o + RNG + 2] = (s >>> 8) & 255;
      grid[o + RNG + 3] = s & 255;
      grid[o + AIM] = 128;
      grid[o + MODE] = SERVE;
      grid[o + TIMER] = SERVE_STEPS;
      const range = freeRange(grid, o, w);
      placeServe(grid, o, w, range ? ((range[0] + range[1] + 1) * 128) | 0 : 0);
      if (!range) grid[o + MODE] = OUT;
    },
    step(src, dst, w, h, stepIndex) {
      dst.set(src);
      const lh = h - metaRows(w);
      const o = w * lh;
      const hw = Math.round(padHalf(w) * 256);

      // Dozvuk záblesků a počet zbývajících cihel.
      let bricks = 0;
      for (let i = 0; i < o; i++) {
        const v = dst[i];
        if (v >= FLASH_MIN) dst[i] = v - FLASH_FADE >= FLASH_MIN ? v - FLASH_FADE : 0;
        else if (v > 0 && v < WALL) bricks++;
      }

      const range = freeRange(dst, o, w);
      let mode = dst[o + MODE];
      let timer = dst[o + TIMER];
      if (!range) mode = OUT;
      else if (stepIndex === STEPS_PER_CYCLE - BLINK_STEPS) {
        mode = CLEAR;
        timer = BLINK_STEPS;
      }

      let padX = get16(dst, o + PX);
      let bx = get16(dst, o + BX);
      let by = get16(dst, o + BY);
      let vx = dst[o + VX] - 128;
      let vy = dst[o + VY] - 128;

      // Pálka: sleduje míček (při minutí se mu vyhne), rychlost je omezená.
      if (range) {
        let target;
        if (mode === PLAY) {
          target = bx - Math.round((dst[o + AIM] - 128) * hw / 127);
          if (dst[o + MISS] && vy > 0) {
            target = bx + (bx < (range[0] + range[1] + 1) * 128 ? 1 : -1) * (hw + HX + 400);
          }
        } else {
          target = ((range[0] + range[1] + 1) * 128) | 0;
        }
        const lo = range[0] * 256 + hw;
        const hi = (range[1] + 1) * 256 - hw;
        target = lo > hi ? ((range[0] + range[1] + 1) * 128) | 0 : Math.max(lo, Math.min(hi, target));
        padX += Math.max(-PAD_SPEED, Math.min(PAD_SPEED, target - padX));
      }

      if (mode === SERVE) {
        placeServe(dst, o, w, padX);
        bx = get16(dst, o + BX);
        by = get16(dst, o + BY);
        if (timer > 0) timer--;
        if (timer === 0) {
          if (hitBox(dst, w, lh, bx, by, false)) {
            timer = 6; // místo nad pálkou je zablokované, zkusí se znovu, až se pálka posune
          } else {
            mode = PLAY;
            vy = -SPEED;
            vx = (rand(dst, o) < 0.5 ? -1 : 1) * (16 + Math.floor(rand(dst, o) * 24));
            dst[o + MISS] = rand(dst, o) < MISS_CHANCE ? 1 : 0;
            dst[o + AIM] = 128 + Math.round((rand(dst, o) * 2 - 1) * 0.8 * 127);
          }
        }
      } else if (mode === PLAY) {
        if (bricks === 0) {
          mode = CLEAR;
          timer = BLINK_STEPS;
        } else {
          let nx = bx + vx;
          if (hitBox(dst, w, lh, nx, by, true)) vx = -vx;
          else bx = nx;
          const ny = by + vy;
          const col = Math.max(0, Math.min(w - 1, bx >> 8));
          const row = dst[o + META + col];
          const padTop = row === NONE ? lh * 256 : row * 256 + PAD_TOP;
          let done = false;
          if (vy > 0) {
            const onPad = Math.abs(bx - padX) <= hw + HX;
            if (onPad && by + HY <= padTop && ny + HY >= padTop) {
              by = padTop - HY - 1;
              bounceOffPaddle(dst, o, w, bx, padX, hw);
              vx = dst[o + VX] - 128;
              vy = dst[o + VY] - 128;
              done = true;
            } else if (ny + HY >= padTop + 128) {
              mode = OUT;
              timer = OUT_STEPS;
              done = true;
            }
          }
          if (!done) {
            if (hitBox(dst, w, lh, bx, ny, true)) vy = -vy;
            else by = ny;
          }
        }
      } else if (mode === OUT) {
        if (timer > 0) timer--;
        if (timer === 0 && range) {
          mode = SERVE;
          timer = SERVE_STEPS;
        }
      } else {
        if (timer > 0) timer--;
        if (timer === 0) {
          restoreBricks(dst, w, lh);
          mode = SERVE;
          timer = SERVE_STEPS;
          dst[o + MISS] = 0;
        }
      }

      set16(dst, o + PX, padX);
      set16(dst, o + BX, bx);
      set16(dst, o + BY, by);
      dst[o + VX] = 128 + vx;
      dst[o + VY] = 128 + vy;
      dst[o + MODE] = mode;
      dst[o + TIMER] = timer;
    },
  },
  glsl: `const int META = 16;
  const float HX = 0.2;
  const float HY = 0.4;
  int W = int(uStateSize.x);
  if (W < 1) return vec3(0.0);
  int LH = int(uStateSize.y) - 1 - (META + W - 1) / W;
  vec2 p = vLocal * vec2(float(W), float(LH));
  vec2 fw = max(fwidth(p), vec2(1e-4));
  ivec2 c = clamp(ivec2(floor(p)), ivec2(0), ivec2(W - 1, LH - 1));
  vec2 f = p - vec2(c);

  // Metadata: míček, pálka, režim hry.
  float m[16];
  for (int k = 0; k < 16; k++) m[k] = floor(texelFetch(uState, ivec2(k % W, LH + k / W), 0).r * 255.0 + 0.5);
  vec2 ball = vec2(m[0] * 256.0 + m[1], m[2] * 256.0 + m[3]) / 256.0;
  vec2 vel = vec2(m[4] - 128.0, m[5] - 128.0) / 256.0;
  float padX = (m[6] * 256.0 + m[7]) / 256.0;
  float mode = m[8];
  float timer = m[9];
  if (mode > 0.5 && mode < 1.5) ball += vel * uStateFrac;
  float padHalf = min(max(1.5, float(W) * 0.1), float(W) * 0.5);

  // Cihla: odstín z řady, světlejší horní hrana, tmavší spodní.
  float v = floor(texelFetch(uState, c, 0).r * 255.0 + 0.5);
  vec2 e = min(f - vec2(0.035, 0.07), vec2(0.965, 0.93) - f);
  float body = clamp(min(e.x / fw.x, e.y / fw.y) + 0.5, 0.0, 1.0);
  vec3 col = vec3(0.0);
  if (v >= 240.0) {
    float k = clamp((v - 236.0 - 4.0 * uStateFrac) / 19.0, 0.0, 1.0);
    col = mix(uColB, vec3(1.0), 0.7) * k * body;
  } else if (v > 0.5 && v < 200.5) {
    float r = v - 1.0;
    vec3 brick = mix(uColB, uColB.gbr, 0.5 * mod(r, 6.0) / 5.0) * (0.85 + 0.15 * cos(r * 1.7));
    if (f.y < 0.28) brick = mix(brick, vec3(1.0), 0.35);
    else if (f.y > 0.78) brick *= 0.7;
    col = brick * body;
  }
  if (mode > 2.5) col = mix(col, uColA, (mod(timer, 10.0) < 5.0 ? 0.4 : 0.0));

  // Pálka na spodním řádku sloupce.
  int bk = META + c.x;
  float bottom = floor(texelFetch(uState, ivec2(bk % W, LH + bk / W), 0).r * 255.0 + 0.5);
  if (bottom < 250.0 && float(c.y) == bottom) {
    float pe = min((padHalf - abs(p.x - padX)) / fw.x, min(f.y - 0.1, 0.9 - f.y) / fw.y);
    col = mix(col, uColA, clamp(pe + 0.5, 0.0, 1.0));
  }

  // Míček (čtverec) je vidět při podání a ve hře.
  if (mode < 1.5) {
    vec2 d = abs(p - ball);
    float be = min((HX - d.x) / fw.x, (HY - d.y) / fw.y);
    col = mix(col, uColA, clamp(be + 0.5, 0.0, 1.0));
  }
  return col;`,
};
