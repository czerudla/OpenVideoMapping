// Ohňostroj – rakety stoupají zespodu oblasti, vybuchují do kulatých výbuchů a jiskry padají a hasnou.
// Každá raketa je deterministická funkce slotu a cyklu (poloha, výška, barva, počet jisker).
// Sloty 0–2 jsou skoro pořád aktivní, sloty 3 a 4 mají delší pauzy, takže je na scéně 3–5 raket.
// Výkon: 5 slotů × nejvýše 48 jisker s konstantními mezemi a levným testem vzdálenosti.
// Rozložení uData: [0] = (minX, minY, šířka, výška) obalu oblasti v prostoru s poměrem stran.
function precompute(points, aspect) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x * aspect); maxX = Math.max(maxX, x * aspect);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const w = maxX - minX, h = maxY - minY;
  if (!(w > 1e-6 && h > 1e-6)) return new Float32Array(0);
  return new Float32Array([minX, minY, w, h]);
}

export default {
  id: 'fireworks',
  name: 'Ohňostroj',
  colors: 2,
  precompute,
  glsl: `vec3 col = vec3(0.0);
  vec2 q = vUV * vec2(uAspect, 1.0);
  float fw = max(length(fwidth(q)), 1e-6);
  if (uDataCount < 1) return col;
  vec4 bb = uData[0];
  vec2 l = vec2(q.x - bb.x, bb.y + bb.w - q.y);
  float sc = min(bb.z, bb.w);
  #define RND(a, b, c) fract(sin(dot(vec3(a, b, c), vec3(12.9898, 78.233, 37.719))) * 43758.5453)
  const float LIFE = 3.1;
  const float KD = 2.2;

  for (int sl = 0; sl < 5; sl++) {
    float fs = float(sl);
    float sd = fs + 1.0;
    float gap = sl < 3 ? 0.1 + 0.5 * fs : 1.4 + 0.8 * (fs - 3.0);
    float per = LIFE + gap;
    float tt = t + fs * 1.913;
    float cyc = floor(tt / per);
    float lt = tt - cyc * per - RND(sd, cyc, 1.0) * gap;
    if (lt < 0.0 || lt >= LIFE) continue;

    float tr = 0.9 + 0.2 * RND(sd, cyc, 2.0);
    float x0 = (0.15 + 0.7 * RND(sd, cyc, 3.0)) * bb.z;
    float ya = (0.45 + 0.4 * RND(sd, cyc, 4.0)) * bb.w;
    float hc = RND(sd, cyc, 5.0);
    vec3 bc = hc < 0.33 ? uColA : (hc < 0.66 ? uColB : 0.5 * (uColA + uColB));
    float s = lt - tr;

    if (s < 0.0) {
      float tau = lt / tr;
      if (abs(l.x - x0) > 0.05 * sc || l.y > ya + 0.03 * sc) continue;
      float rr = max(0.007 * sc, fw);
      for (int k = 0; k < 7; k++) {
        float fk = float(k);
        float tk = max(tau - 0.035 * fk, 0.0);
        float yk = ya * (1.0 - (1.0 - tk) * (1.0 - tk));
        float jx = (RND(sd + fk, floor(t * 24.0), 6.0) - 0.5) * 0.012 * sc * fk;
        vec2 d = l - vec2(x0 + jx, yk);
        float fade = 1.0 - fk / 7.0;
        col += bc * exp(-dot(d, d) / (rr * rr)) * fade * (k == 0 ? 0.9 : 0.45);
      }
      continue;
    }

    float R = (0.2 + 0.12 * RND(sd, cyc, 7.0)) * sc;
    int n = 30 + int(RND(sd, cyc, 8.0) * 18.99);
    float tw = step(0.5, RND(sd, cyc, 9.0));
    float tb = LIFE - 1.1;
    float grav = 0.12 * sc;
    col += bc * 0.12 * exp(-s * 7.0);

    vec2 rel = l - (vec2(x0, ya) - vec2(0.0, 0.5 * grav * s * s));
    float bound = R * (1.0 - exp(-KD * s)) + 0.07 * sc;
    if (dot(rel, rel) > bound * bound) continue;
    float run1 = (1.0 - exp(-KD * s)) / KD;
    float run0 = (1.0 - exp(-KD * max(s - 0.07, 0.0))) / KD;
    float rad = max(0.006 * sc, fw);
    float lim = 0.07 * sc;
    for (int i = 0; i < 48; i++) {
      if (i >= n) break;
      float fi = float(i) * 1.37 + sd;
      float ang = 6.2831853 * RND(fi, cyc, 10.0);
      float sp = 0.75 + 0.25 * RND(fi, cyc, 11.0);
      float h3 = RND(fi, cyc, 12.0);
      float fade = 1.0 - s / (tb * (0.7 + 0.3 * h3));
      if (fade <= 0.0) continue;
      vec2 dir = vec2(cos(ang), sin(ang)) * (R * KD * sp);
      vec2 p1 = dir * run1;
      vec2 w = rel - p1;
      if (dot(w, w) > lim * lim) continue;
      vec2 p0 = dir * run0;
      vec2 e = p1 - p0;
      vec2 v = rel - p0;
      float h = clamp(dot(v, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
      vec2 dv = v - e * h;
      float flick = (tw > 0.5 && s > 0.5 * tb) ? 0.3 + 0.7 * step(0.5, fract(s * 14.0 + h3 * 9.0)) : 1.0;
      col += bc * exp(-dot(dv, dv) / (rad * rad)) * fade * fade * flick;
    }
  }
  return col;`,
};
