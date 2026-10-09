// Padající míčky – kulaté míčky padají shora, odskakují od spodního okraje oblasti a mizí.
export default {
  id: 'balls',
  group: 'show',
  name: 'Padající míčky',
  colors: 2,
  glsl: `const float COLS = 7.0;
  const float PERIOD = 5.0;
  const float REST = 0.4;
  vec2 bbox = fwidth(vUV) / max(fwidth(vLocal), vec2(1e-9));
  vec2 size = bbox * vec2(uAspect, 1.0);
  vec2 q = vec2(vLocal.x, 1.0 - vLocal.y) * size;
  float colW = size.x / COLS;
  float col = clamp(floor(q.x / colW), 0.0, COLS - 1.0);
  float r = size.x * 0.05;
  float drop = max(size.y - r, 0.0);
  float s = mod(t + hash(vec2(col, 7.0)) * PERIOD, PERIOD);
  float y = -1.0e3;
  if (s < 1.0) {
    y = r + drop * (1.0 - s * s);
  } else {
    s -= 1.0;
    float k = REST;
    for (int i = 0; i < 3; i++) {
      float dur = 2.0 * sqrt(k);
      if (s < dur) {
        float u = s / dur * 2.0 - 1.0;
        y = r + drop * k * (1.0 - u * u);
        break;
      }
      s -= dur;
      k *= REST;
    }
  }
  vec2 center = vec2((col + 0.5) * colW, y);
  float fw = max(max(fwidth(q.x), fwidth(q.y)), 1e-6);
  float ball = clamp((r - length(q - center)) / fw + 0.5, 0.0, 1.0);
  return mix(uColB, uColA, ball);`,
};
