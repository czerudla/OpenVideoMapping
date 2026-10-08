// Duha – posouvající se spektrum přes celou plochu.
export default {
  id: 'rainbow',
  name: 'Duha',
  colors: 0,
  glsl: `return hsv2rgb(vec3(fract(vUV.x * 0.6 + vUV.y * 0.2 + t * 0.15), 0.85, 1.0));`,
};
