// Třpyt – náhodně blikající body.
export default {
  id: 'sparkle',
  group: 'basic',
  name: 'Třpyt',
  colors: 2,
  glsl: `vec2 g = floor(vUV * vec2(uAspect, 1.0) * 50.0);
  float r = hash(g);
  float tw = pow(max(0.0, sin(t * 2.0 + r * 40.0)), 16.0) * step(0.6, r);
  return mix(uColB, uColA, tw);`,
};
