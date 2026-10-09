// Lávová lampa – pomalu stoupající a klesající kapky vosku (metaballs) nad kalužou na dně.
// Počítá se v souřadnicích oblasti se zachovaným poměrem stran, takže jsou kapky kulaté.
export default {
  id: 'lavalamp',
  group: 'retro',
  name: 'Lávová lampa',
  colors: 2,
  glsl: `const int BLOBS = 7;
  // Velikost oblasti (v jednotkách vUV s poměrem stran) z poměru derivací vUV a vLocal.
  vec2 sz = fwidth(vUV) / max(fwidth(vLocal), vec2(1e-9)) * vec2(uAspect, 1.0);
  sz = max(sz, vec2(1e-4));
  float m = min(sz.x, sz.y);
  vec2 p = vec2(vLocal.x, 1.0 - vLocal.y) * sz; // počátek dole vlevo, y nahoru
  float yUp = p.y / sz.y;

  // Kaluž na dně: úsečka podél dna s mírně dýchajícím poloměrem.
  float rp = m * 0.11 * (1.0 + 0.12 * sin(t * 0.35));
  vec2 pc = vec2(clamp(p.x, rp, max(sz.x - rp, rp)), rp * 0.4);
  vec2 dp = p - pc;
  float f = rp * rp / max(dot(dp, dp), 1e-6);
  vec2 g = -2.0 * f * dp / max(dot(dp, dp), 1e-6);

  for (int i = 0; i < BLOBS; i++) {
    float fi = float(i);
    float h1 = hash(vec2(fi, 1.3));
    float h2 = hash(vec2(fi, 7.1));
    float h3 = hash(vec2(fi, 13.7));
    float h4 = hash(vec2(fi, 21.9));
    float r = m * (0.07 + 0.08 * h1);
    // Jedna perioda trvá 24–40 s, takže výšku oblasti kapka urazí za 12–20 s.
    float w = 6.2831853 / (24.0 + 16.0 * h2);
    float k = 0.5 + 0.5 * sin(t * w + 6.2831853 * h3);
    float yc = mix(r * 0.6, max(sz.y - r, r * 0.6), k);
    float xc = sz.x * (fi + 0.5) / float(BLOBS) + (h4 - 0.5) * 0.5 * sz.x / float(BLOBS)
      + m * 0.06 * sin(t * w * 1.7 + 6.2831853 * h4);
    vec2 d = p - vec2(xc, yc);
    float d2 = max(dot(d, d), 1e-6);
    float v = r * r / d2;
    f += v;
    g += -2.0 * v * d / d2;
  }

  // Tekutina: svislý gradient (dole tmavší) a teplá záře odspodu jako od žárovky.
  vec3 liquid = uColB * mix(0.3, 1.0, smoothstep(0.0, 0.9, yUp));
  liquid += vec3(1.0, 0.45, 0.1) * 0.35 * pow(1.0 - yUp, 3.0);

  // Vosk: měkký okraj, světlejší střed, lehký odlesk a ohřátí odspodu.
  float aa = 0.06 + fwidth(f);
  float wax = smoothstep(1.0 - aa, 1.0 + aa, f);
  float core = smoothstep(1.0, 3.5, f);
  vec3 wc = mix(uColA * 0.85, mix(uColA, vec3(1.0), 0.3), core);
  wc = mix(wc, wc * vec3(1.0, 0.85, 0.7), pow(1.0 - yUp, 2.0) * 0.5);
  vec2 n = -g / max(length(g), 1e-6);
  float rim = pow(max(dot(n, normalize(vec2(-0.5, 0.8))), 0.0), 4.0) * (1.0 - smoothstep(1.0, 2.2, f));
  wc += vec3(1.0) * 0.25 * rim;
  return mix(liquid, wc, wax);`,
};
