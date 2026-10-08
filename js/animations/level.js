// Hladina – stoupající a klesající vlnitá hladina.
export default {
  id: 'level',
  name: 'Hladina',
  colors: 2,
  glsl: `float lvl = 0.5 + 0.35 * sin(t * 0.6) + 0.03 * sin(vLocal.x * 14.0 + t * 3.0);
  return mix(uColB, uColA, smoothstep(lvl - 0.01, lvl + 0.01, vLocal.y));`,
};
