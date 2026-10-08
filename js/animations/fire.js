// Oheň – plameny z fbm šumu.
export default {
  id: 'fire',
  name: 'Oheň',
  colors: 2,
  glsl: `float n = fbm(vec2(vLocal.x * 3.0, vLocal.y * 2.0 + t * 1.2));
  float i = n * pow(vLocal.y, 0.8) * 1.7;
  vec3 c = mix(vec3(0.0), uColB, smoothstep(0.1, 0.45, i));
  c = mix(c, uColA, smoothstep(0.45, 0.8, i));
  return c + vec3(1.0, 0.9, 0.6) * smoothstep(0.85, 1.15, i);`,
};
