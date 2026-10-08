// Pac-Man objíždí obvod oblasti po dráze uvnitř hrany a polyká kuličky; po kole se kuličky obnoví.
export default {
  id: 'pacman',
  name: 'Pac-Man',
  colors: 2,
  glsl: `const float SPEED = 0.3;
  const float MAX_R = 0.05;
  const float PAUSE = 1.2;
  const float REVEAL = 0.6;
  const float EPS = 0.01;
  vec2 A = vec2(uAspect, 1.0);
  vec2 q = vUV * A;

  // Rozměry oblasti a orientace polygonu (znaménko plochy určuje, kde je vnitřek).
  vec2 lo = vec2(1e9);
  vec2 hi = vec2(-1e9);
  float area = 0.0;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    vec2 a = polyV(i);
    vec2 b = polyV(polyNext(i));
    lo = min(lo, a);
    hi = max(hi, a);
    area += a.x * b.y - a.y * b.x;
  }
  float side = area >= 0.0 ? 1.0 : -1.0;
  float R = clamp(0.06 * min(hi.x - lo.x, hi.y - lo.y), 0.0005, MAX_R);
  float inset = R * 1.3;
  float rb = R * 0.22;
  float per = max(polyPerimeter(), 0.001);

  // Kuliček je celý počet, rozestup zhruba 2,5 průměru Pac-Mana.
  float n = max(floor(per / (5.0 * R) + 0.5), 3.0);
  float sp = per / n;

  // Čas: kolo, pauza, krátké probliknutí kuliček před dalším kolem.
  float lap = per / SPEED;
  float ph = mod(t, lap + PAUSE);
  float sPac = min(ph * SPEED, per);
  bool reveal = ph > lap + PAUSE - REVEAL;
  float blink = step(0.5, fract((ph - lap - PAUSE) * 10.0));

  vec3 col = uColB;
  vec3 ballCol = mix(uColA, vec3(1.0), 0.7);
  float aa = 0.002;
  float arc = polyArc(vUV);
  float k0 = floor(arc / sp);

  // Průchod 0–2: tři nejbližší kuličky, průchod 3: Pac-Man. Všichni jedou po stejné dráze.
  for (int k = 0; k < 4; k++) {
    float s = k == 3 ? sPac : (k0 + float(k - 1) + 0.5) * sp;
    vec2 p0 = polyPoint(s) * A;
    vec2 t1 = p0 - polyPoint(s - EPS) * A;
    vec2 t2 = polyPoint(s + EPS) * A - p0;
    t1 /= max(length(t1), 1e-6);
    t2 /= max(length(t2), 1e-6);
    vec2 n1 = side * vec2(-t1.y, t1.x);
    vec2 n2 = side * vec2(-t2.y, t2.x);
    vec2 nm = n1 + n2;
    nm = length(nm) > 1e-4 ? normalize(nm) : n2;
    vec2 c = p0 + nm * inset / clamp(dot(nm, n2), 0.35, 1.0);
    vec2 d = q - c;
    float r = length(d);
    if (k == 3) {
      // Pusa se otevírá a zavírá, míří ve směru jízdy.
      float open = 0.05 + 0.65 * abs(sin(ph * 7.0));
      float mouth = smoothstep(cos(open) - 0.02, cos(open) + 0.02, dot(d, t2) / max(r, 1e-6));
      col = mix(col, uColA, smoothstep(R, R - aa, r) * (1.0 - mouth));
    } else {
      float sw = mod(s, per);
      bool eaten = reveal ? false : sPac >= sw;
      float vis = reveal ? blink : 1.0;
      if (!eaten) col = mix(col, ballCol, smoothstep(rb, rb - aa, r) * vis);
    }
  }
  return col;`,
};
