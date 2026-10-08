// Řezání autogenem – žhavý hořák objíždí obvod oblasti, za ním chladne spára a lítají jiskry.
export default {
  id: 'torch',
  name: 'Řezání autogenem',
  colors: 2,
  glsl: `const float SPEED = 0.25;
  const float INSET = 0.02;
  const float WIDTH = 0.01;
  const float GRAVITY = 0.6;
  vec2 A = vec2(uAspect, 1.0);
  vec2 q = vUV * A;
  float per = max(polyPerimeter(), 0.001);
  float burn = max(per / SPEED, 1.0);
  float ph = mod(t, burn + 1.5);
  bool cutting = ph < burn;
  float s = min(ph * SPEED, per);

  // Plocha uvnitř: kovová textura, na konci cyklu ztmavne, na začátku naběhne.
  float plate = smoothstep(0.0, 0.4, ph) * (1.0 - smoothstep(burn, burn + 1.0, ph));
  vec3 col = uColB * (0.75 + 0.25 * fbm(q * vec2(40.0, 4.0))) * plate;

  // Spára: jen na prořezaném úseku, barva podle stáří řezu.
  float arc = polyArc(vUV);
  float d = polyDist(vUV);
  float age = (ph * SPEED - arc) / SPEED;
  float cut = step(arc, s) * step(0.0, age);
  float end = 1.0 - smoothstep(burn + 1.0, burn + 1.5, ph);
  vec3 hot = mix(vec3(1.0, 1.0, 0.8), uColA, smoothstep(0.15, 0.8, age));
  hot = mix(hot, vec3(0.3, 0.02, 0.0), smoothstep(0.8, 2.5, age));
  hot = mix(hot, vec3(0.03), smoothstep(2.5, 4.5, age));
  float ad = abs(d + INSET);
  float heat = 1.0 - smoothstep(0.8, 3.0, age);
  col += uColA * 0.35 * heat * exp(-ad / 0.03) * cut * plate;
  col = mix(col, hot, smoothstep(WIDTH, WIDTH * 0.3, ad) * cut * end);

  // Poloha hořáku posunutá dovnitř oblasti (směr z gradientu vzdálenosti) a směr jízdy.
  vec2 t0 = polyPoint(s) * A;
  float e = 0.003;
  vec2 g = vec2(polyDist((t0 + vec2(e, 0.0)) / A) - polyDist((t0 - vec2(e, 0.0)) / A),
                polyDist((t0 + vec2(0.0, e)) / A) - polyDist((t0 - vec2(0.0, e)) / A));
  vec2 tp = t0 - g / max(length(g), 1e-6) * INSET;
  vec2 tang = t0 - polyPoint(s - 0.03) * A;
  tang /= max(length(tang), 1e-6);

  // Záře hořáku.
  float flick = 0.8 + 0.4 * noise(vec2(t * 30.0, 1.7));
  float r = length(q - tp);
  float on = cutting ? 1.0 : 0.0;
  float core = exp(-r * r / 0.00025);
  col += mix(vec3(0.6, 0.8, 1.0), vec3(1.0), core) * (core + 0.3 * exp(-r / 0.04)) * flick * on;

  // Jiskry: pevný počet, každá má vlastní fázi a život, vylétá z místa, kde hořák byl.
  for (int k = 0; k < 32; k++) {
    float fk = float(k);
    float h = hash(vec2(fk, 1.0));
    float life = 0.6 + 0.4 * h;
    float u = ph / life + hash(vec2(fk, 2.0));
    float sa = fract(u) * life;
    float gen = floor(u);
    float ts = ph - sa;
    if (ts <= 0.0 || ts >= burn) continue;
    float a = hash(vec2(fk + gen * 37.0, 3.0)) * 6.2832;
    float v = 0.08 + 0.25 * hash(vec2(fk + gen * 37.0, 4.0));
    vec2 pos = tp - tang * (s - min(ts * SPEED, per)) + vec2(cos(a), sin(a)) * v * sa + vec2(0.0, 0.5 * GRAVITY * sa * sa);
    float k1 = 1.0 - sa / life;
    float b = smoothstep(0.007, 0.0, length(q - pos)) * k1;
    col += mix(uColA, vec3(1.0, 0.9, 0.6), k1) * b * 1.5;
  }
  return col;`,
};
