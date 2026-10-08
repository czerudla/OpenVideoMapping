// Pong – na každé hraně oblasti jezdí pálka a míček se odráží mezi nimi napříč oblastí.
// Dráhu míčku předpočítá JS (precompute), shader podle času vykreslí míček i pálky.
// Po vyčerpání odrazů míček proletí kolem pálky k hraně („aut“), oblast blikne a hra začne znovu.
// Rozložení uData: [0] = (poloměr míčku, délka cyklu, čas autu, orientace obvodu),
// [1] = (nejdelší pálka, nejkratší pálka, 0, 0), dále záznamy (čas, x, y, hrana):
// první je start (hrana -1), poslední je aut. Souřadnice mají poměr stran (x * aspect, y).
const MAX_POLY = 64; // musí odpovídat MAX_POLY v shaderu
const MAX_BOUNCES = 24;
const MAX_STEPS = 60000;
const BALL = 0.022; // poloměr míčku jako podíl menšího rozměru oblasti
const GAP = 0.6; // odsazení pálky od hrany (násobek poloměru míčku)
const THICK = 0.8; // tloušťka pálky (násobek poloměru míčku)
const PADDLE_FRAC = 0.18; // délka pálky jako podíl délky hrany
const PADDLE_MAX = 0.22; // nejdelší pálka jako podíl menšího rozměru oblasti
const PADDLE_MIN = 3; // nejkratší pálka (násobek poloměru míčku), kratší hrany pálku nemají
const SERVE = 0.6; // čekání míčku na startu
const FLASH = 0.6; // blikání po autu
const TAIL = 0.4; // pauza po blikání

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

// Vzdálenost bodu od úsečky a jednotková normála od nejbližšího bodu úsečky k bodu.
function segDist(a, b, x, y, out) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const wx = x - a[0], wy = y - a[1];
  const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-12)));
  const px = wx - ex * h, py = wy - ey * h;
  const d = Math.hypot(px, py);
  out.d = d;
  out.nx = d > 1e-12 ? px / d : 0;
  out.ny = d > 1e-12 ? py / d : 0;
  return out;
}

// Nejhlubší průnik míčku s hranou (s odsazením pálky), ke které se míček blíží.
function violation(poly, clear, x, y, vx, vy, out) {
  const probe = {};
  let best = 0;
  out.edge = -1;
  for (let i = 0; i < poly.length; i++) {
    segDist(poly[i], poly[(i + 1) % poly.length], x, y, probe);
    const slack = probe.d - clear[i];
    if (slack < best && vx * probe.nx + vy * probe.ny < 0) {
      best = slack;
      out.edge = i; out.nx = probe.nx; out.ny = probe.ny; out.slack = slack;
    }
  }
  return out.edge >= 0;
}

// Nejbližší průsečík paprsku s obvodem: vzdálenost a index hrany.
function rayHit(poly, x, y, dx, dy) {
  let best = Infinity, edge = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = a[0] - x, wy = a[1] - y;
    const s = (wx * ey - wy * ex) / den;
    const u = (wx * dy - wy * dx) / den;
    if (s > 1e-9 && u >= 0 && u <= 1 && s < best) { best = s; edge = i; }
  }
  return { s: best, edge };
}

// Start v těžišti, případně v nejbližším bodě mřížky, kam se míček vejde.
function findStart(poly, clear, box) {
  const probe = {};
  const fits = (x, y) => {
    if (!inside(poly, x, y)) return false;
    for (let i = 0; i < poly.length; i++) {
      if (segDist(poly[i], poly[(i + 1) % poly.length], x, y, probe).d < clear[i]) return false;
    }
    return true;
  };
  let cx = 0, cy = 0, area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const f = ax * by - bx * ay;
    area += f; cx += (ax + bx) * f; cy += (ay + by) * f;
  }
  if (Math.abs(area) > 1e-12) {
    cx /= 3 * area; cy /= 3 * area;
    if (fits(cx, cy)) return [cx, cy];
  } else {
    cx = (box.minX + box.maxX) / 2; cy = (box.minY + box.maxY) / 2;
  }
  const N = 48;
  let best = null, bd = Infinity;
  for (let iy = 0; iy <= N; iy++) {
    for (let ix = 0; ix <= N; ix++) {
      const x = box.minX + ((box.maxX - box.minX) * ix) / N;
      const y = box.minY + ((box.maxY - box.minY) * iy) / N;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd && fits(x, y)) { bd = d; best = [x, y]; }
    }
  }
  return best;
}

function precompute(points, aspect) {
  const none = new Float32Array(0);
  // Stejné zjednodušení jako v rendereru (každý k-tý bod), aby seděly indexy hran.
  const step = Math.max(1, Math.ceil(points.length / MAX_POLY));
  const poly = [];
  for (let i = 0; i < points.length; i += step) poly.push([points[i][0] * aspect, points[i][1]]);
  if (poly.length < 3) return none;

  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of poly) {
    box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
  }
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  if (!(bw > 1e-6 && bh > 1e-6)) return none;

  let r = BALL * Math.min(bw, bh);
  const pmax = PADDLE_MAX * Math.min(bw, bh);
  const pmin = PADDLE_MIN * r;
  // Hrana s pálkou drží míček dál od obvodu (odsazení + tloušťka pálky).
  const clear = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return Math.min(PADDLE_FRAC * len, pmax) >= pmin ? r * (1 + GAP + THICK) : r;
  });
  let signed = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    signed += a[0] * b[1] - b[0] * a[1];
  });
  const start = findStart(poly, clear, box);
  if (!start) return none;

  const rnd = mulberry32(seedFrom(points));
  const speed = 0.5 * Math.sqrt(bw * bh);
  // Úhel mimo osy, aby se míček nehýbal jen sem a tam.
  const ang = ((rnd() * 0.5 + 0.1) + Math.floor(rnd() * 4)) * (Math.PI / 2);
  let vx = Math.cos(ang), vy = Math.sin(ang);
  let x = start[0], y = start[1];
  let time = SERVE;
  const recs = [[time, x, y, -1]];
  const ds = 0.35 * r;
  const hit = {};
  let bounces = 0;

  for (let n = 0; n < MAX_STEPS && bounces < MAX_BOUNCES; n++) {
    const nx = x + vx * ds, ny = y + vy * ds;
    if (!violation(poly, clear, nx, ny, vx, vy, hit)) {
      x = nx; y = ny; time += ds / speed;
      continue;
    }
    // Přesný okamžik dotyku: bisekce mezi posledním volným a prvním zasaženým krokem.
    let lo = 0, hi = ds;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (violation(poly, clear, x + vx * m, y + vy * m, vx, vy, {})) hi = m; else lo = m;
    }
    x += vx * lo; y += vy * lo; time += lo / speed;
    const vn = vx * hit.nx + vy * hit.ny;
    vx -= 2 * vn * hit.nx; vy -= 2 * vn * hit.ny;
    const len = Math.hypot(vx, vy);
    vx /= len; vy /= len;
    recs.push([time, x, y, hit.edge]);
    bounces++;
  }

  // Aut: míček pokračuje přímo až na obvod, pálka na té hraně ujede na opačnou stranu.
  const ray = rayHit(poly, x, y, vx, vy);
  if (ray.edge < 0) return none;
  recs.push([time + ray.s / speed, x + vx * ray.s, y + vy * ray.s, ray.edge]);
  const tAut = recs[recs.length - 1][0];

  const out = new Float32Array((2 + recs.length) * 4);
  out.set([r, tAut + FLASH + TAIL, tAut, signed >= 0 ? 1 : -1]);
  out.set([pmax, pmin, 0, 0], 4);
  recs.forEach((rec, i) => out.set(rec, 8 + i * 4));
  return out;
}

export default {
  id: 'pong',
  name: 'Pong',
  colors: 2,
  precompute,
  glsl: `vec3 bg = uColB;
  if (uDataCount < 4) return bg;
  float r = uData[0].x;
  float cycle = uData[0].y;
  float tAut = uData[0].z;
  float sgn = uData[0].w;
  float pmax = uData[1].x;
  float pmin = uData[1].y;
  float tt = mod(t, cycle);
  vec2 q = vUV * vec2(uAspect, 1.0);
  float fw = max(length(fwidth(q)), 1e-6);
  int last = uDataCount - 1;

  float flash = 0.0;
  if (tt >= tAut && tt < tAut + ${FLASH.toFixed(2)}) {
    flash = step(fract((tt - tAut) / ${FLASH.toFixed(2)} * 2.0), 0.5);
  }
  bg = mix(uColB, uColA, flash * 0.5);
  float ink = 0.0;

  int k = 2;
  for (int i = 2; i < MAX_DATA; i++) {
    if (i >= uDataCount) break;
    if (uData[i].x <= tt) k = i;
  }
  int k2 = min(k + 1, last);
  vec4 pa = uData[k];
  vec4 pb = uData[k2];
  float u = k2 > k ? clamp((tt - pa.x) / max(pb.x - pa.x, 1e-6), 0.0, 1.0) : 0.0;
  vec2 c = mix(pa.yz, pb.yz, u);
  if (tt < tAut + 0.08) {
    vec2 dd = abs(q - c);
    ink = max(ink, clamp(0.5 - (max(dd.x, dd.y) - r * 0.9) / fw, 0.0, 1.0));
  }

  float gap = r * ${GAP.toFixed(2)};
  float th = r * ${THICK.toFixed(2)};
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    vec2 a = polyV(i);
    vec2 e = polyV(polyNext(i)) - a;
    float len = length(e);
    float pl = min(${PADDLE_FRAC.toFixed(2)} * len, pmax);
    if (len <= 0.0 || pl < pmin) continue;
    vec2 ux = e / len;
    vec2 nn = sgn * vec2(-ux.y, ux.x);
    vec2 w = q - a;
    float s = dot(w, ux);
    float dn = dot(w, nn);
    if (dn < -fw || dn > gap + th + fw || s < -fw || s > len + fw) continue;

    float cp = 0.5 * len;
    float cn = cp;
    float tp = 0.0;
    float tn = -1.0;
    for (int j = 3; j < MAX_DATA; j++) {
      if (j >= uDataCount) break;
      if (int(uData[j].w + 0.5) != i) continue;
      float h = dot(uData[j].yz - a, ux);
      float tgt = clamp(h, 0.5 * pl, len - 0.5 * pl);
      if (j == last) tgt = h < 0.5 * len ? len - 0.5 * pl : 0.5 * pl;
      if (uData[j].x <= tt) { cp = tgt; tp = uData[j].x; }
      else { cn = tgt; tn = uData[j].x; break; }
    }
    float pos = mix(cp, 0.5 * len, smoothstep(tAut, cycle, tt));
    if (tn >= 0.0) {
      float st = tp + 0.3 * (tn - tp);
      pos = mix(cp, cn, smoothstep(0.0, 1.0, clamp((tt - st) / max(tn - st, 1e-6), 0.0, 1.0)));
    }
    float dx = abs(s - pos) - 0.5 * pl;
    float dy = abs(dn - gap - 0.5 * th) - 0.5 * th;
    ink = max(ink, clamp(0.5 - max(dx, dy) / fw, 0.0, 1.0));
  }
  return mix(bg, uColA, ink);`,
};
