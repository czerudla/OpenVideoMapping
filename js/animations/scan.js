// Skenovací pás – pás probíhající oblastí shora dolů.
export default {
  id: 'scan',
  group: 'basic',
  name: 'Skenovací pás',
  colors: 2,
  glsl: `float d = vLocal.y - fract(t * 0.4);
  return mix(uColB, uColA, exp(-d * d * 400.0));`,
};
