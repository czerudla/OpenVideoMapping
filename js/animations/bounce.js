// Odrážející se míček – jeden míček spadne do oblasti a odráží se od jejích skutečných hran.
// Dráhu předpočítá JS (precompute) po úsecích paraboly, shader ji jen vyhodnotí podle času.
// Rozložení uData: [0] = (poloměr, délka cyklu, gravitace, konec dráhy),
// dále 2 záznamy na úsek: (t0, x, y, trvání) a (vx, vy, 0, 0). Souřadnice mají poměr stran (x * aspect, y).
const MAX_SEGMENTS = 31;
const RESTITUTION = 0.88;
const MAX_TIME = 40;
const MAX_STEPS = 40000;
const FADE = 0.5;
const PAUSE = 0.3;

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

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
  }
  return c;
}

// Nejbližší bod hranice: vzdálenost a jednotková normála směřující od hranice k bodu.
function nearest(poly, x, y, out) {
  let best = Infinity;
  let nx = 0, ny = -1;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const ex = bx - ax, ey = by - ay;
    const wx = x - ax, wy = y - ay;
    const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-12)));
    const px = wx - ex * h, py = wy - ey * h;
    const d = px * px + py * py;
    if (d < best) { best = d; nx = px; ny = py; }
  }
  const d = Math.sqrt(best);
  if (d > 1e-12) { nx /= d; ny /= d; } else { nx = 0; ny = -1; }
  out.d = d; out.nx = nx; out.ny = ny;
  return out;
}

// Nejvyšší bod, kam se vejde míček o poloměru r (mřížka přes ohraničující obdélník, shora dolů).
function findStart(poly, r, box) {
  const N = 48;
  const probe = {};
  for (let iy = 0; iy <= N; iy++) {
    const y = box.minY + ((box.maxY - box.minY) * iy) / N;
    let best = null;
    for (let ix = 0; ix <= N; ix++) {
      const x = box.minX + ((box.maxX - box.minX) * ix) / N;
      if (!inside(poly, x, y) || nearest(poly, x, y, probe).d < r) continue;
      if (!best || Math.abs(x - box.cx) < Math.abs(best[0] - box.cx)) best = [x, y];
    }
    if (best) return best;
  }
  return null;
}

function precompute(points, aspect) {
  const poly = points.map(([x, y]) => [x * aspect, y]);
  if (poly.length < 3) return new Float32Array(0);
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of poly) {
    box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
  }
  box.cx = (box.minX + box.maxX) / 2;
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  if (!(bw > 1e-6 && bh > 1e-6)) return new Float32Array(0);

  // Když se míček o výchozím poloměru nevejde (úzký tvar), zmenší se.
  let r = 0.04 * Math.min(bw, bh);
  let start = null;
  for (let k = 0; k < 8 && !start; k++) {
    start = findStart(poly, r, box);
    if (!start) r *= 0.7;
  }
  if (!start) return new Float32Array(0);

  const rnd = mulberry32(seedFrom(points));
  const g = 4 * bh;
  let seg = { t0: 0, x: start[0], y: start[1], vx: (rnd() * 2 - 1) * 0.3 * bh, vy: 0 };
  const segs = [seg];
  const probe = {};
  let tau = 0;
  let end = MAX_TIME;
  let closed = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const speed = Math.hypot(seg.vx, seg.vy + g * tau);
    const dt = Math.max(1e-4, Math.min(1 / 120, (0.4 * r) / Math.max(speed, 1e-6)));
    const pos = (s) => [seg.x + seg.vx * s, seg.y + seg.vy * s + 0.5 * g * s * s];
    const next = tau + dt;
    if (seg.t0 + next > MAX_TIME) break;
    const [x1, y1] = pos(next);
    nearest(poly, x1, y1, probe);
    const vy1 = seg.vy + g * next;
    if (probe.d >= r || seg.vx * probe.nx + vy1 * probe.ny >= 0) {
      tau = next;
      continue;
    }
    // Přesný okamžik dotyku: bisekce mezi posledním platným a prvním zasaženým krokem.
    let lo = tau, hi = next;
    const [lx, ly] = pos(lo);
    if (nearest(poly, lx, ly, probe).d >= r - 1e-9) {
      for (let k = 0; k < 30; k++) {
        const [mx, my] = pos((lo + hi) / 2);
        if (nearest(poly, mx, my, probe).d >= r) lo = (lo + hi) / 2; else hi = (lo + hi) / 2;
      }
    } else {
      lo = hi;
    }
    let [cx, cy] = pos(lo);
    nearest(poly, cx, cy, probe);
    const { nx, ny } = probe;
    const push = Math.max(0, r - probe.d) + 1e-6;
    cx += nx * push; cy += ny * push;
    const vx = seg.vx, vy = seg.vy + g * lo;
    const vn = vx * nx + vy * ny;
    const hitT = seg.t0 + lo;
    seg.dur = hitT - seg.t0;
    if (segs.length >= MAX_SEGMENTS) { end = hitT; closed = true; break; }
    seg = { t0: hitT, x: cx, y: cy, vx: vx - (1 + RESTITUTION) * vn * nx, vy: vy - (1 + RESTITUTION) * vn * ny };
    segs.push(seg);
    tau = 0;
  }
  if (!closed) {
    seg.dur = tau;
    end = seg.t0 + tau;
  }

  const out = new Float32Array((1 + 2 * segs.length) * 4);
  out.set([r, end + FADE + PAUSE, g, end]);
  segs.forEach((s, i) => {
    out.set([s.t0, s.x, s.y, s.dur], 4 + i * 8);
    out.set([s.vx, s.vy, 0, 0], 8 + i * 8);
  });
  return out;
}

export default {
  id: 'bounce',
  name: 'Odrážející se míček',
  colors: 2,
  precompute,
  glsl: `vec3 bg = uColB;
  if (uDataCount < 3) return bg;
  float r = uData[0].x;
  float cycle = uData[0].y;
  float g = uData[0].z;
  float tEnd = uData[0].w;
  int n = (uDataCount - 1) / 2;
  float tt = mod(t, cycle);
  int k = 1;
  for (int i = 1; i < MAX_DATA / 2; i++) {
    if (i > n) break;
    if (uData[2 * i - 1].x <= tt) k = i;
  }
  vec4 a = uData[2 * k - 1];
  vec4 b = uData[2 * k];
  float tau = clamp(tt - a.x, 0.0, a.w);
  vec2 c = a.yz + b.xy * tau + vec2(0.0, 0.5 * g * tau * tau);
  vec2 q = vUV * vec2(uAspect, 1.0);
  vec2 d = (q - c) / r;
  float fw = max(length(fwidth(q)), 1e-6) / r;
  float alpha = 1.0 - clamp((tt - tEnd) / ${FADE.toFixed(1)}, 0.0, 1.0);
  float shadow = smoothstep(1.6, 0.4, length(d - vec2(0.3, 0.45))) * 0.35;
  bg *= 1.0 - shadow * alpha;
  float ball = clamp((1.0 - length(d)) / fw + 0.5, 0.0, 1.0) * alpha;
  float light = clamp(1.0 - length(d - vec2(-0.35, -0.4)) * 0.8, 0.0, 1.0);
  vec3 col = mix(uColA * 0.8, mix(uColA, vec3(1.0), 0.5), light * light);
  return mix(bg, col, ball);`,
};
