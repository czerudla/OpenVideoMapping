// Kruhy – soustředné kruhy šířící se od středu oblasti.
export default {
  id: 'rings',
  group: 'basic',
  name: 'Kruhy',
  colors: 2,
  glsl: `float d = length(vLocal - 0.5);
  return mix(uColB, uColA, 0.5 + 0.5 * sin(d * 40.0 - t * 4.0));`,
};
