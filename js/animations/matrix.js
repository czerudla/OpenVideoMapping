// Matrix – svislé proudy procedurálních znaků stékají shora dolů, jasná hlava a slábnoucí ocas.
export default {
  id: 'matrix',
  name: 'Matrix',
  colors: 2,
  glsl: `const vec2 CELL = vec2(0.0175, 0.025);
  vec2 p = vUV * vec2(uAspect, 1.0);
  vec2 cell = floor(p / CELL);
  float rows = 1.0 / CELL.y;
  float row = floor(rows) - 1.0 - cell.y;
  float tail = 10.0 + floor(hash(vec2(cell.x, 3.0)) * 16.0);
  float len = rows + tail;
  float speed = 6.0 + hash(vec2(cell.x, 5.0)) * 10.0;
  float head = mod(t * speed + hash(vec2(cell.x, 9.0)) * len, len);
  float d = mod(head - row, len);
  if (d >= tail) return uColB;
  vec2 f = fract(p / CELL);
  vec2 g = floor(vec2(f.x * 7.0, f.y * 9.0)) - 1.0;
  if (g.x < 0.0 || g.x > 4.0 || g.y < 0.0 || g.y > 6.0) return uColB;
  float seed = hash(cell) * 100.0 + floor(t * 1.5 + hash(cell + 3.7) * 8.0);
  float on = step(0.5, hash(vec2(seed, g.x + g.y * 5.0 + 1.0)));
  float k = pow(1.0 - d / tail, 1.5);
  vec3 c = d < 1.0 ? mix(uColA, vec3(1.0), 0.85) : uColA;
  return mix(uColB, c, on * (d < 1.0 ? 1.0 : k));`,
};
