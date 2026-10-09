// Polární záře – vlnící se závěsy světla se svislými paprsky nad noční oblohou s hvězdami.
// Rozložení se vztahuje k ohraničení oblasti (vLocal). A = hlavní barva záře u spodního okraje, B = barva horních okrajů závěsů.
export default {
  id: 'aurora',
  group: 'nature',
  name: 'Polární záře',
  colors: 2,
  glsl: `vec2 bbox = fwidth(vUV) / max(fwidth(vLocal), vec2(1e-9));
  vec2 size = bbox * vec2(uAspect, 1.0);
  vec2 p = vLocal * vec2(size.x / max(size.y, 1e-6), 1.0);
  float h = 1.0 - vLocal.y;
  vec3 sky = mix(vec3(0.004, 0.006, 0.02), vec3(0.015, 0.03, 0.07), pow(1.0 - h, 2.0));
  vec2 cell = floor(p * 90.0);
  float r = hash(cell);
  vec2 sp = fract(p * 90.0) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5;
  float twinkle = 0.65 + 0.35 * sin(t * 1.5 + r * 60.0);
  float star = step(0.985, r) * smoothstep(0.28, 0.0, length(sp)) * twinkle * (0.4 + 0.6 * hash(cell + 1.3));
  vec3 aur = vec3(0.0);
  float cover = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = p.x * (1.0 + 0.25 * fi);
    float edge = 0.28 + 0.14 * fi + 0.22 * (fbm(vec2(x * 0.9 + fi * 7.0, t * 0.05 + fi * 3.0)) - 0.5);
    float d = h - edge;
    float body = smoothstep(0.0, 0.05, d) * exp(-d * (3.0 + fi));
    float shift = (fbm(vec2(x * 0.7 + t * 0.03, fi * 5.0 + t * 0.04)) - 0.5) * 1.5;
    float rays = 0.35 + 0.65 * noise(vec2((x + shift * d) * 38.0, fi * 11.0 + t * 0.15));
    float glow = 0.35 + 0.65 * fbm(vec2(x * 1.4 - t * 0.06, fi * 5.0 + t * 0.08));
    float k = body * rays * glow * (1.15 - 0.2 * fi);
    vec3 col = mix(uColA, uColB, smoothstep(0.0, 0.5, d));
    aur += col * k;
    cover += k;
  }
  vec3 horizon = uColA * 0.07 * exp(-h * 7.0);
  vec3 c = sky + horizon + vec3(0.85, 0.9, 1.0) * star * (1.0 - min(cover, 1.0) * 0.85);
  return c + aur;`,
};
