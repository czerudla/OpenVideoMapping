// Sdílený kód shaderů. Animace jsou v js/animations/. Každá animace je tělo GLSL
// funkce `vec3 anim(float t)`.
// K dispozici: vUV (0–1 v celé ploše), vLocal (0–1 v rámci oblasti),
// uColA, uColB, uAspect, volitelná data z precompute (uData, uDataCount) a pomocné funkce hsv2rgb, hash, noise, fbm.
// Stav simulace (`sim` animace): uState (R8, NEAREST), uStateSize (w, h; 0 bez simulace), uStateFrac (0–1 mezi kroky).
// Tvar oblasti: uPoly, uPolyCount a funkce polyDist, polyPerimeter, polyArc, polyPoint.

// Nejvyšší počet vec4 záznamů, které animace může vrátit z precompute().
export const MAX_DATA = 64;

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
#define MAX_POLY 64
uniform vec2 uPoly[MAX_POLY];
uniform int uPolyCount;
#define MAX_DATA ${MAX_DATA}
uniform vec4 uData[MAX_DATA];
uniform int uDataCount;
uniform sampler2D uState;
uniform vec2 uStateSize;
uniform float uStateFrac;
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

// Vrchol polygonu v prostoru se zachovaným poměrem stran.
vec2 polyV(int i) { return uPoly[i] * vec2(uAspect, 1.0); }
int polyNext(int i) { return i + 1 >= uPolyCount ? 0 : i + 1; }

// Znaménková vzdálenost k hranici polygonu (uvnitř záporná), i pro nekonvexní tvary.
float polyDist(vec2 uv) {
  vec2 q = uv * vec2(uAspect, 1.0);
  float d = 1e9;
  float s = 1.0;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    vec2 a = polyV(i);
    vec2 b = polyV(polyNext(i));
    vec2 e = b - a;
    vec2 w = q - a;
    vec2 p = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    d = min(d, dot(p, p));
    bvec3 c = bvec3(q.y >= a.y, q.y < b.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}

// Délka obvodu polygonu.
float polyPerimeter() {
  float len = 0.0;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    len += length(polyV(polyNext(i)) - polyV(i));
  }
  return len;
}

// Poloha nejbližšího bodu hranice měřená po obvodu od prvního vrcholu.
float polyArc(vec2 uv) {
  vec2 q = uv * vec2(uAspect, 1.0);
  float best = 1e9;
  float arc = 0.0;
  float acc = 0.0;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    vec2 a = polyV(i);
    vec2 b = polyV(polyNext(i));
    vec2 e = b - a;
    vec2 w = q - a;
    float h = clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
    vec2 p = w - e * h;
    float d = dot(p, p);
    float l = length(e);
    if (d < best) { best = d; arc = acc + h * l; }
    acc += l;
  }
  return arc;
}

// Bod na obvodu ve vzdálenosti s po obvodu (souřadnice vUV); s se cyklicky zalamuje.
vec2 polyPoint(float s) {
  float per = polyPerimeter();
  if (per <= 0.0) return uPoly[0];
  s = mod(s, per);
  vec2 res = uPoly[0];
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    int j = polyNext(i);
    float l = length(polyV(j) - polyV(i));
    if (s <= l || j == 0) {
      res = mix(uPoly[i], uPoly[j], l > 0.0 ? clamp(s / l, 0.0, 1.0) : 0.0);
      break;
    }
    s -= l;
  }
  return res;
}

vec3 anim(float t);
void main() {
  vec3 c = anim(uTime);
  outColor = vec4(clamp(c, 0.0, 1.0) * uBright, 1.0);
}
`;

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

export function buildFragment(body) {
  return `${FRAGMENT_HEADER}\nvec3 anim(float t) {\n  ${body}\n}\n`;
}
