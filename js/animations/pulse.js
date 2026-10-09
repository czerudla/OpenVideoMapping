// Dýchání – plynulé prolínání mezi barvou A a B.
export default {
  id: 'pulse',
  group: 'basic',
  name: 'Dýchání',
  colors: 2,
  glsl: `float k = 0.5 + 0.5 * sin(t * 3.14159);
  return mix(uColB, uColA, k * k);`,
};
