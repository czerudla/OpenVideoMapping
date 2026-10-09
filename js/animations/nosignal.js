// Porucha signálu: obsah, VHS glitche, sníh a monoskop (cyklus 16 s), mezi fázemi „přepnutí kanálu“.
export default {
  id: 'nosignal',
  group: 'retro',
  name: 'Porucha signálu',
  colors: 2,
  glsl: `const float CYCLE = 16.0;
  vec2 A = vec2(uAspect, 1.0);
  float p = mod(t, CYCLE);
  vec3 col = vec3(0.0);

  // Obdélník oblasti v prostoru se zachovaným poměrem stran (střed monoskopu).
  vec2 lo = vec2(1e9);
  vec2 hi = vec2(-1e9);
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    lo = min(lo, polyV(i));
    hi = max(hi, polyV(i));
  }
  vec2 ctr = 0.5 * (lo + hi);
  vec2 hs = max(0.5 * (hi - lo), vec2(1e-4));
  vec2 q = vUV * A - ctr;

  float scan = 0.88 + 0.12 * sin(vUV.y * 700.0);

  if (p < 4.0) {
    // 1. Obsah: pomalý přechod A a B.
    float m = 0.5 + 0.5 * sin(t * 0.5 + q.x * 2.0 + q.y * 1.5);
    col = mix(uColA, uColB, m) * scan;
  } else if (p < 8.0) {
    // 2. VHS porucha: sílí s časem.
    float k = (p - 4.0) / 4.0;
    float tf = floor(t * 12.0);
    vec2 uv = vUV;
    // Občasné zaskočení obrazu.
    float snap = step(0.85 - 0.25 * k, hash(vec2(floor(t * 3.0), 7.0)));
    uv.y = fract(uv.y + snap * (hash(vec2(floor(t * 3.0), 3.0)) - 0.5) * 0.4);
    // Tracking: vodorovné posuny pruhů.
    float band = floor(uv.y * 28.0);
    float on = step(0.75 - 0.5 * k, hash(vec2(band, tf)));
    float shift = (hash(vec2(band, tf + 11.0)) - 0.5) * 0.25 * k * on;
    float ca = (0.004 + 0.02 * k) * (0.5 + hash(vec2(tf, 5.0)));
    vec3 s = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float x = (uv.x + shift + (float(i) - 1.0) * ca) * uAspect - ctr.x;
      float m = 0.5 + 0.5 * sin(t * 0.5 + x * 2.0 + (uv.y - ctr.y) * 1.5);
      s[i] = mix(uColA, uColB, m)[i];
    }
    col = s * scan;
    // Šumový pruh putující svisle.
    float by = 1.0 - fract(t * 0.25);
    float bar = (1.0 - smoothstep(0.0, 0.07, abs(vUV.y - by))) * (0.4 + 0.6 * k);
    vec2 cell = floor(vUV * A * 200.0);
    float g = hash(cell + mod(t, 64.0) * 31.7);
    col = mix(col, vec3(g), bar);
    col += (hash(cell + mod(t, 64.0) * 17.3) - 0.5) * 0.25 * k;
  } else if (p < 11.0) {
    // 3. Sníh: černobílý šum, zrno v souřadnicích plochy, každý snímek nové.
    vec2 cell = floor(vUV * A * 220.0);
    float g = hash(cell + mod(t, 64.0) * 37.1);
    g = mix(g, hash(cell * 1.7 + mod(t, 64.0) * 11.9), 0.35);
    col = vec3(g) * (0.9 + 0.1 * sin(vUV.y * 500.0 + t * 40.0));
  } else {
    // 4. Monoskop: barevné pruhy, středový kruh se šedou škálou a mřížkou.
    float xl = clamp((q.x + hs.x) / (2.0 * hs.x), 0.0, 0.9999);
    int si = int(floor(xl * 7.0));
    vec3 bars = si == 0 ? vec3(1.0)
      : si == 1 ? vec3(1.0, 1.0, 0.0)
      : si == 2 ? vec3(0.0, 1.0, 1.0)
      : si == 3 ? vec3(0.0, 1.0, 0.0)
      : si == 4 ? vec3(1.0, 0.0, 1.0)
      : si == 5 ? vec3(1.0, 0.0, 0.0)
      : vec3(0.0, 0.0, 1.0);
    col = bars * 0.9;
    float R = 0.8 * min(hs.x, hs.y);
    float r = length(q);
    if (r < R) {
      // Dolní půlka: šedá škála, horní: šedé pozadí s mřížkou.
      float steps = floor(clamp(q.x / R * 0.5 + 0.5, 0.0, 0.999) * 8.0) / 7.0;
      vec3 inner = q.y < 0.0 ? vec3(steps) : vec3(0.45);
      float cellSize = R * 0.25;
      vec2 gq = abs(fract(q / cellSize + 0.5) - 0.5) * cellSize;
      float lw = R * 0.012;
      float grid = 1.0 - smoothstep(lw * 0.5, lw, min(gq.x, gq.y));
      inner = mix(inner, vec3(0.95), grid * step(0.0, q.y));
      col = inner * 0.95;
    }
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, R * 0.02, abs(r - R))));
    col *= scan;
    col *= 1.0 - 0.45 * smoothstep(0.25, 0.75, length(vLocal - 0.5) * 1.4);
  }

  // Přepnutí kanálu: kolem každé hranice fází se obraz stáhne do vodorovné čáry se zábleskem.
  float dn = 1e9;
  for (int i = 0; i < 4; i++) {
    float b = i == 0 ? 0.0 : i == 1 ? 4.0 : i == 2 ? 8.0 : 11.0;
    float d = abs(p - b);
    dn = min(dn, min(d, CYCLE - d));
  }
  float sq = 1.0 - smoothstep(0.0, 0.3, dn);
  float h = mix(0.5, 0.006, sq * sq);
  float vis = (1.0 - smoothstep(h, h + 0.01, abs(vLocal.y - 0.5)));
  col = mix(col, vec3(1.0), 0.7 * sq * sq) * vis;
  return col;`,
};
