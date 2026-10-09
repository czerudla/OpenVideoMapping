// Pruhy – pohybující se diagonální pruhy.
export default {
  id: 'stripes',
  group: 'basic',
  name: 'Pruhy',
  colors: 2,
  glsl: `float s = abs(fract((vLocal.x + vLocal.y) * 4.0 - t * 0.8) * 2.0 - 1.0);
  return mix(uColB, uColA, smoothstep(0.45, 0.55, s));`,
};
