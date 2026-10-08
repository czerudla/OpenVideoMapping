// Rozpadající se zeď – cihlová zeď, ze které se cihly uvolňují a padají, a pak se znovu postaví.
// Cyklus 12 s: klid, rozpad od středu, tma, stavba v opačném pořadí. A = cihly, B = malta.
// Každý pixel vyhodnotí jen okolní buňky: 3 sloupce v řadách od 5 nad sebou po 1 pod sebou.
// Padající cihla zhasne dřív, než by zasáhla dál než do 5. řady pod sebou, takže se nikde neřeže.
export default {
  id: 'bricks',
  name: 'Rozpadající se zeď',
  colors: 2,
  glsl: `vec2 sz = fwidth(vUV) / max(fwidth(vLocal), vec2(1e-9)) * vec2(uAspect, 1.0);
  float rh = sz.y / 14.0;
  float bw = 2.0 * rh;
  vec2 P = vLocal * sz;
  float fw = max(length(fwidth(P)), 1e-6);
  float tt = mod(t, 12.0);
  int R = int(floor(P.y / rh));
  vec3 cS = vec3(0.0);
  vec3 cM = vec3(0.0);
  float aM = 0.0;
  for (int k = 5; k >= -1; k--) {
    int j = R - k;
    if (j < 0 || j > 13) continue;
    float odd = mod(float(j), 2.0);
    int ci = int(floor((P.x + odd * 0.5 * bw) / bw));
    for (int dc = -1; dc <= 1; dc++) {
      float i = float(ci + dc);
      vec2 id = vec2(i, float(j));
      vec2 cell = vec2((i + 0.5) * bw - odd * 0.5 * bw, (float(j) + 0.5) * rh);
      float h1 = hash(id + 0.5);
      float h2 = hash(id + 7.3);
      float h3 = hash(id + 13.1);
      float sg = h3 < 0.5 ? -1.0 : 1.0;
      vec2 nc = cell / sz;
      float ord = clamp(0.5 * length(nc - 0.5) / 0.71 + 0.15 * nc.y + 0.35 * h1, 0.0, 1.0);
      float rel = 1.5 + 3.2 * ord;
      float arr = 7.0 + 3.2 * (1.0 - ord);
      vec2 off = vec2(0.0);
      float rot = 0.0;
      float vis = 1.0;
      bool mv = true;
      if (tt >= arr) {
        mv = false;
      } else if (tt >= arr - 0.5) {
        float u = (tt - (arr - 0.5)) / 0.5;
        off.y = -3.0 * rh * (1.0 - u * u);
        rot = sg * 0.15 * (1.0 - u);
        vis = smoothstep(0.0, 0.3, u);
      } else if (tt >= rel + 0.45) {
        float tau = tt - rel - 0.45;
        off = vec2(sg * 0.25 * rh * tau, 14.0 * rh * tau * tau);
        rot = sg * min(0.8 * tau, 0.45);
        vis = 1.0 - smoothstep(3.2 * rh, 4.5 * rh, off.y);
      } else if (tt >= rel) {
        float w = (tt - rel) / 0.45;
        off = vec2(sin(tt * 70.0 + h2 * 6.28) * 0.03 * rh * w, -0.05 * rh * sin(3.14159 * w));
        rot = sin(tt * 55.0 + h3 * 6.28) * 0.02 * w;
      } else {
        mv = false;
      }
      if (vis <= 0.0) continue;
      vec2 d = P - cell - off;
      float cr = cos(rot);
      float sr = sin(rot);
      vec2 q = vec2(cr * d.x + sr * d.y, -sr * d.x + cr * d.y);
      vec2 hs = vec2(bw, rh) * 0.5;
      vec2 e = abs(q) - hs;
      float cov = clamp(1.0 - max(e.x, e.y) / fw, 0.0, 1.0);
      if (cov <= 0.0) continue;
      float m = 0.09 * rh;
      vec2 ei = abs(q) - (hs - m);
      float covIn = clamp(0.5 - max(ei.x, ei.y) / fw, 0.0, 1.0);
      float edge = 0.15 * rh;
      float topd = q.y + hs.y - m;
      float botd = hs.y - m - q.y;
      float sided = hs.x - m - abs(q.x);
      float shade = 1.0 + 0.3 * (1.0 - smoothstep(0.0, edge, topd))
        - 0.35 * (1.0 - smoothstep(0.0, edge, botd))
        - 0.15 * (1.0 - smoothstep(0.0, edge, sided));
      vec2 tp = q / rh * 5.0 + vec2(h3, h1) * 40.0;
      vec3 brick = uColA * (0.75 + 0.45 * h2) * (0.8 + 0.4 * noise(tp)) * shade;
      vec3 mortar = uColB * (0.85 + 0.3 * noise(q / rh * 9.0 + h3 * 30.0));
      vec3 bc = mix(mortar, brick, covIn) * vis;
      if (mv) {
        cM = mix(cM, bc, cov);
        aM = aM + cov * (1.0 - aM);
      } else {
        cS = mix(cS, bc, cov);
      }
    }
  }
  return cM + cS * (1.0 - aM);`,
};
