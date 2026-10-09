// Skok do hyperprostoru – hvězdy se protáhnou do světelných čar, záblesk, tunel a návrat do klidu.
// Cyklus 10 s (při rychlosti 1×): klid 0–5 s, skok 5–6 s, tunel 6–9 s, výstup 9–10 s.
// Střed perspektivy je střed oblasti, počítá se v prostoru se zachovaným poměrem stran.
// Hvězdy jsou v polárních buňkách (úhlový výsek × 2 hvězdy × 3 vrstvy), bez smyček přes jednotlivé hvězdy.
export default {
  id: 'hyperspace',
  group: 'show',
  name: 'Skok do hyperprostoru',
  colors: 2,
  glsl: `// Střed a velikost oblasti z obdélníku okolo vrcholů.
  vec2 lo = vec2(1e9), hi = vec2(-1e9);
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    lo = min(lo, uPoly[i]);
    hi = max(hi, uPoly[i]);
  }
  vec2 ctr = 0.5 * (lo + hi);
  vec2 ext = 0.5 * (hi - lo) * vec2(uAspect, 1.0);
  float rad = max(length(ext), 1e-4);
  vec2 p = (vUV - ctr) * vec2(uAspect, 1.0);
  float r = max(length(p), 1e-5);
  float px = fwidth(r);

  // Fáze cyklu: s = roztažení čar, W = uražená dráha (spojitá), tun = síla tunelu.
  float cyc = floor(t / 10.0);
  float ph = t - cyc * 10.0;
  float jx = clamp(ph - 5.0, 0.0, 1.0);
  float ex = clamp(ph - 9.0, 0.0, 1.0);
  float s = 0.0;
  float W = 0.0;
  if (ph >= 9.0) {
    s = (1.0 - ex) * (1.0 - ex);
    W = 3.3333 + (1.0 - pow(1.0 - ex, 3.0)) / 3.0;
  } else if (ph >= 6.0) {
    s = 1.0;
    W = 0.3333 + (ph - 6.0);
  } else if (ph >= 5.0) {
    s = jx * jx;
    W = jx * jx * jx / 3.0;
  }
  float way = cyc * 3.6667 + W;
  float tun = smoothstep(0.4, 1.0, jx) * (1.0 - smoothstep(0.0, 0.6, ex));
  float flash = smoothstep(5.5, 6.0, ph) * (1.0 - smoothstep(6.0, 6.5, ph));

  // Hvězdy a čáry.
  vec3 col = vec3(0.0);
  float ang = atan(p.y, p.x) * 0.159155 + 0.5;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float n = 30.0 + 20.0 * fl;
    float dth = 6.28318 / n;
    float f = ang * n;
    float cell = floor(f);
    float fi = f - cell;
    float z = t * 0.07 * (1.0 + 0.6 * fl) + way * 0.35 * (1.0 + 0.5 * fl);
    for (int k = 0; k < 2; k++) {
      vec2 id = vec2(mod(cell, n) + 31.0 * fl, 7.0 * float(k) + 3.0 * fl);
      float h0 = hash(id);
      float h1 = hash(id + 17.3);
      float h2 = hash(id + 41.7);
      float h3 = hash(id + 63.1);
      float xs = fract(h0 + z);
      float dx = 0.012 + s * (0.25 + 0.35 * h1);
      float rs = rad * xs * xs;
      float rt = rad * max(xs - dx, 0.0) * max(xs - dx, 0.0);
      float dt = (fi - (0.25 + 0.5 * h1)) * dth * r;
      float wd = rad * (0.0025 + 0.004 * h2 * h2);
      wd = max(min(wd, 0.25 * dth * rs), 0.8 * px);
      float d = length(vec2(dt, max(max(rt - r, r - rs), 0.0)));
      float core = 1.0 - smoothstep(0.5 * wd, wd + 0.5 * px, d);
      float len = rs - rt;
      float u = clamp((r - rt) / max(len, 1e-5), 0.0, 1.0);
      float tf = mix(1.0, mix(0.15, 1.0, u * u), smoothstep(2.0 * wd, 6.0 * wd, len));
      float tw = 1.0 - (1.0 - s) * 0.35 * (0.5 + 0.5 * sin(t * (2.0 + 4.0 * h2) + h3 * 40.0));
      float b = (0.35 + 0.65 * h3) * (0.25 + 0.75 * xs) * smoothstep(0.0, 0.15, xs)
        * (1.0 - smoothstep(0.92, 1.0, xs));
      col += uColA * core * tf * tw * b;
    }
  }

  // Tunel: víření v polárních souřadnicích, pohyb k divákovi.
  if (tun > 0.001) {
    float rn = r / rad;
    vec2 dir = p / r;
    float depth = 0.4 / (rn + 0.1);
    float v = depth + way * 1.5;
    float a = depth * 0.5 + t * 0.15;
    vec2 d2 = vec2(dir.x * cos(a) - dir.y * sin(a), dir.x * sin(a) + dir.y * cos(a));
    float q = fbm(d2 * 2.2 + vec2(v * 1.3, v * 0.6));
    float ring = 0.5 + 0.5 * sin(v * 14.0);
    vec3 tc = uColB * (0.2 + 0.8 * q) * (0.6 + 0.4 * ring) + uColA * smoothstep(0.55, 0.95, q) * 0.6;
    tc += mix(uColB, uColA, 0.5) * exp(-rn * 5.0) * 0.9;
    col += tc * tun;
  }

  // Záblesk při skoku.
  col += uColB * flash * 1.5;
  return col;`,
};
