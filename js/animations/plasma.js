// Plazma – prolínající se sinusové vzory.
export default {
  id: 'plasma',
  group: 'basic',
  name: 'Plazma',
  colors: 2,
  glsl: `vec2 p = vUV * vec2(uAspect, 1.0) * 4.0;
  float v = sin(p.x + t) + sin(p.y * 1.3 - t * 0.7)
          + sin((p.x + p.y) * 0.7 + t * 1.3) + sin(length(p - 2.0) * 1.5 - t);
  return mix(uColB, uColA, 0.5 + 0.125 * v);`,
};
