// Knihovna animací. Každá animace je tělo GLSL funkce `vec3 anim(float t)`.
// K dispozici: vUV (0–1 v celé ploše), vLocal (0–1 v rámci oblasti),
// uColA, uColB, uAspect a pomocné funkce hsv2rgb, hash, noise, fbm.
// Nová animace = nový záznam v poli ANIMATIONS.

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat3 uH;
uniform vec4 uBBox;
out vec2 vUV;
out vec2 vLocal;
void main() {
  vUV = aPos;
  vLocal = (aPos - uBBox.xy) / max(uBBox.zw, vec2(1e-6));
  vec3 p = uH * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, p.z);
}`;

export const FRAGMENT_HEADER = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vLocal;
uniform float uTime;
uniform float uBright;
uniform float uAspect;
uniform vec3 uColA;
uniform vec3 uColB;
out vec4 outColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
vec3 anim(float t);
void main() {
  vec3 c = anim(uTime);
  outColor = vec4(clamp(c, 0.0, 1.0) * uBright, 1.0);
}
`;

export const ANIMATIONS = [
  {
    id: 'solid', name: 'Plná barva', colors: 1,
    glsl: `return uColA;`,
  },
  {
    id: 'pulse', name: 'Dýchání', colors: 2,
    glsl: `float k = 0.5 + 0.5 * sin(t * 3.14159);
  return mix(uColB, uColA, k * k);`,
  },
  {
    id: 'rainbow', name: 'Duha', colors: 0,
    glsl: `return hsv2rgb(vec3(fract(vUV.x * 0.6 + vUV.y * 0.2 + t * 0.15), 0.85, 1.0));`,
  },
  {
    id: 'stripes', name: 'Pruhy', colors: 2,
    glsl: `float s = abs(fract((vLocal.x + vLocal.y) * 4.0 - t * 0.8) * 2.0 - 1.0);
  return mix(uColB, uColA, smoothstep(0.45, 0.55, s));`,
  },
  {
    id: 'scan', name: 'Skenovací pás', colors: 2,
    glsl: `float d = vLocal.y - fract(t * 0.4);
  return mix(uColB, uColA, exp(-d * d * 400.0));`,
  },
  {
    id: 'level', name: 'Hladina', colors: 2,
    glsl: `float lvl = 0.5 + 0.35 * sin(t * 0.6) + 0.03 * sin(vLocal.x * 14.0 + t * 3.0);
  return mix(uColB, uColA, smoothstep(lvl - 0.01, lvl + 0.01, vLocal.y));`,
  },
  {
    id: 'rings', name: 'Kruhy', colors: 2,
    glsl: `float d = length(vLocal - 0.5);
  return mix(uColB, uColA, 0.5 + 0.5 * sin(d * 40.0 - t * 4.0));`,
  },
  {
    id: 'plasma', name: 'Plazma', colors: 2,
    glsl: `vec2 p = vUV * vec2(uAspect, 1.0) * 4.0;
  float v = sin(p.x + t) + sin(p.y * 1.3 - t * 0.7)
          + sin((p.x + p.y) * 0.7 + t * 1.3) + sin(length(p - 2.0) * 1.5 - t);
  return mix(uColB, uColA, 0.5 + 0.125 * v);`,
  },
  {
    id: 'fire', name: 'Oheň', colors: 2,
    glsl: `float n = fbm(vec2(vLocal.x * 3.0, vLocal.y * 2.0 + t * 1.2));
  float i = n * pow(vLocal.y, 0.8) * 1.7;
  vec3 c = mix(vec3(0.0), uColB, smoothstep(0.1, 0.45, i));
  c = mix(c, uColA, smoothstep(0.45, 0.8, i));
  return c + vec3(1.0, 0.9, 0.6) * smoothstep(0.85, 1.15, i);`,
  },
  {
    id: 'sparkle', name: 'Třpyt', colors: 2,
    glsl: `vec2 g = floor(vUV * vec2(uAspect, 1.0) * 50.0);
  float r = hash(g);
  float tw = pow(max(0.0, sin(t * 2.0 + r * 40.0)), 16.0) * step(0.6, r);
  return mix(uColB, uColA, tw);`,
  },
  {
    id: 'strobe', name: 'Stroboskop', colors: 2,
    glsl: `return mix(uColB, uColA, step(0.5, fract(t * 2.0)));`,
  },
];

// Kalibrační mřížka přes celou plochu warpu.
export const CALIBRATION_GLSL = `vec2 p = vUV * vec2(uAspect, 1.0) * 8.0;
  vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float grid = 1.0 - clamp(min(g.x, g.y), 0.0, 1.0);
  vec2 b = min(vUV, 1.0 - vUV) / fwidth(vUV);
  float border = 1.0 - clamp(min(b.x, b.y) - 1.5, 0.0, 1.0);
  float r = length((vUV - 0.5) * vec2(uAspect, 1.0));
  float circle = 1.0 - clamp(abs(r - 0.4) / fwidth(r) - 0.5, 0.0, 1.0);
  vec2 cc = abs(vUV - 0.5) / fwidth(vUV);
  float cross = 1.0 - clamp(min(cc.x, cc.y) - 0.5, 0.0, 1.0);
  vec3 c = vec3(0.28) * grid;
  c = max(c, vec3(0.2, 0.75, 1.0) * max(circle, cross));
  return max(c, vec3(1.0, 0.66, 0.23) * border);`;

export function getAnimation(id) {
  return ANIMATIONS.find((a) => a.id === id) ?? ANIMATIONS[0];
}

export function buildFragment(body) {
  return `${FRAGMENT_HEADER}\nvec3 anim(float t) {\n  ${body}\n}\n`;
}
