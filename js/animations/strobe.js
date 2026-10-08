// Stroboskop – ostré střídání barev A a B.
export default {
  id: 'strobe',
  name: 'Stroboskop',
  colors: 2,
  glsl: `return mix(uColB, uColA, step(0.5, fract(t * 2.0)));`,
};
