// Neonový obrys – svítící trubice podél obvodu oblasti s jádrem, září, bzučením a občasným zablikáním.
export default {
  id: 'neon',
  group: 'outline',
  name: 'Neonový obrys',
  colors: 2,
  glsl: `float m = min(uAspect, 1.0);
  float width = 0.006 * m;
  float glow = 0.03 * m;
  float inset = 0.012 * m;

  // Vzdálenost od osy trubice, posunuté dovnitř; záře slábne jen směrem dovnitř.
  float d = polyDist(vUV);
  float r = abs(d + inset);
  float depth = max(-d - inset, 0.0);
  float core = smoothstep(width, width * 0.2, r);
  float halo = exp(-max(r - width, 0.0) / glow * 3.0) * (d + inset < 0.0 ? exp(-depth / glow) : 1.0);

  // Spoje trubice v pravidelných rozestupech po obvodu.
  float per = max(polyPerimeter(), 0.001);
  float sp = per / max(floor(per / 0.6 + 0.5), 1.0);
  float seam = 1.0 - smoothstep(0.0, width * 2.5, abs(mod(polyArc(vUV) + sp * 0.5, sp) - sp * 0.5));

  // Rozsvícení v prvních 2 s: rychlé výpadky, pak svítí trvale.
  float u = clamp(t / 2.0, 0.0, 1.0);
  float lit = step(hash(vec2(floor(u * 16.0), 7.0)), u * u + 0.15 * step(0.25, u));
  float ign = u >= 1.0 ? 1.0 : mix(0.06, 1.0, lit * step(0.1, u));

  // Občasné zablikání: jeden shluk výpadků v každém 10s úseku, odstup 5–15 s.
  float k = floor(t / 10.0);
  float tb = t - (k * 10.0 + 2.5 + hash(vec2(k, 3.0)) * 5.0);
  float fl = (tb > 0.0 && tb < 0.7) ? mix(0.1, 1.0, step(0.45, hash(vec2(floor(tb * 18.0), k)))) : 1.0;

  // Jemné bzučení jasu ±5 %.
  float hum = 1.0 + 0.05 * (noise(vec2(t * 7.0, 1.3)) * 2.0 - 1.0);
  float level = ign * fl * hum;

  vec3 tube = mix(uColA, vec3(1.0), 0.85);
  vec3 col = uColB;
  col += uColA * halo * 0.6 * mix(1.0, 0.5, seam);
  col = mix(col, tube, core * mix(1.0, 0.45, seam));
  return col * level;`,
};
