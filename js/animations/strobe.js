// Stroboskop – ostré střídání barev A a B.
export default {
  id: 'strobe',
  group: 'basic',
  name: 'Stroboskop',
  colors: 2,
  glsl: `return mix(uColB, uColA, step(0.5, fract(t * 2.0)));`,
};
