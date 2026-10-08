// Spořič obrazovky – logo „OVM“ se odráží od okrajů ohraničujícího obdélníku oblasti a při každém
// odrazu změní barvu. Jednou za cyklus se trefí přesně do rohu a oblast ~2 s oslavuje (záblesky, konfety).
// Polohu dává trojúhelníková vlna v každé ose, poměr rychlostí N:M (nesoudělná čísla) se volí podle
// poměru stran oblasti tak, aby dráha byla co nejblíž 45°. Do rohu logo dopadne vždy po půlcyklu.
export default {
  id: 'screensaver',
  name: 'Spořič obrazovky',
  colors: 1,
  glsl: `const float PC = 45.0;
  const float CEL = 2.0;
  int GLYPH[15] = int[15](14, 17, 17, 17, 14, 17, 17, 17, 10, 4, 17, 27, 21, 17, 17);
  vec2 size = (fwidth(vUV) / max(fwidth(vLocal), vec2(1e-9))) * vec2(uAspect, 1.0);
  vec2 q = vLocal * size;
  float fw = max(length(fwidth(q)), 1e-6);
  float lw = min(0.2 * size.x, 1.6 * size.y);
  float lh = 0.5 * lw;
  vec2 range = max(size - vec2(lw, lh), vec2(1e-4));

  float best = 1.0e9;
  float fn = 1.0;
  float fm = 1.0;
  for (int n = 1; n <= 9; n++) {
    for (int m = 1; m <= 9; m++) {
      int a = n;
      int b = m;
      for (int k = 0; k < 6; k++) {
        if (b == 0) break;
        int r = a % b;
        a = b;
        b = r;
      }
      if (a != 1) continue;
      float score = abs(log(float(n) * range.x / (float(m) * range.y))) + 0.03 * abs(float(n + m) - 9.0);
      if (score < best) { best = score; fn = float(n); fm = float(m); }
    }
  }

  float ts = t + 0.5 * PC;
  vec2 p = vec2(fn, fm) * ts / (2.0 * PC);
  vec2 pos = abs(fract(p) * 2.0 - 1.0);
  float hits = floor(2.0 * p.x) + floor(2.0 * p.y);
  float ph = mod(ts, PC);
  bool cel = ph < CEL;
  float ce = ph / CEL;

  vec3 col = vec3(0.0);
  if (cel) {
    float flash = (1.0 - ce) * step(fract(ph * 5.0), 0.5);
    col = hsv2rgb(vec3(fract(floor(ph * 6.0) * 0.17), 1.0, 1.0)) * 0.5 * flash;
    float cs = 0.06 * min(size.x, size.y);
    float colIdx = floor(q.x / cs);
    for (int l = 0; l < 3; l++) {
      float h = hash(vec2(colIdx, float(l) + 3.0));
      float h2 = hash(vec2(colIdx + 17.0, float(l) + 9.0));
      vec2 c = vec2((colIdx + 0.2 + 0.6 * h2) * cs + sin(ph * 8.0 + h * 6.0) * 0.15 * cs,
                    -cs + (size.y + 2.0 * cs) * ce * (0.6 + 0.8 * h));
      vec2 dd = abs(q - c) - 0.2 * cs;
      float a = clamp(0.5 - max(dd.x, dd.y) / fw, 0.0, 1.0);
      col = mix(col, hsv2rgb(vec3(hash(vec2(colIdx, float(l) + 5.0)), 0.9, 1.0)), a);
    }
  }

  vec2 lp = q - (0.5 * vec2(lw, lh) + pos * range);
  float rr = 0.3 * lh;
  vec2 bd = abs(lp) - 0.5 * vec2(lw, lh) + rr;
  float sd = length(max(bd, 0.0)) + min(max(bd.x, bd.y), 0.0) - rr;
  float cover = clamp(0.5 - sd / fw, 0.0, 1.0);
  float hue = cel ? fract(ph * 4.0) : fract(hits * 0.618034);
  vec3 logo = hsv2rgb(vec3(hue, 0.9, 1.0));

  float ps = 0.1 * lh;
  float tx = floor(lp.x / ps + 8.5);
  float ty = floor(lp.y / ps + 2.5);
  float ink = 0.0;
  if (tx >= 0.0 && tx < 17.0 && ty >= 0.0 && ty < 5.0) {
    int cx = int(tx);
    int g = cx / 6;
    int gc = cx - 6 * g;
    if (gc < 5) ink = float((GLYPH[g * 5 + int(ty)] >> (4 - gc)) & 1);
  }
  logo = mix(logo, cel ? uColA : vec3(0.0), ink);
  return mix(col, logo, cover);`,
};
