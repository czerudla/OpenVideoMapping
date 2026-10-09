// Déšť na skle – po zamlženém skle trhaně stékají velké kapky se stopou drobných kapiček,
// kapky lámou rozmazané barevné světlo za sklem (bokeh). Počítá se v souřadnicích plochy
// se zachovaným poměrem stran, takže jsou kapky kulaté a sousední oblasti tvoří jedno okno.
export default {
  id: 'rainglass',
  name: 'Déšť na skle',
  colors: 2,
  glsl: `vec2 p = vec2(vUV.x * uAspect, 1.0 - vUV.y); // y nahoru
  float px = max(fwidth(vUV.y), 1e-5);
  float mask = 0.0;       // krytí nejsilnější kapky v pixelu
  vec2 nrm = vec2(0.0);   // poloha uvnitř kapky (−1..1)
  float rad = 0.03;       // poloměr kapky
  float clearK = 0.0;     // vyčištění skla stopou velké kapky

  // Velké kapky: sloupce s jednou kapkou na buňku, trhavý pohyb dolů, stopa za kapkou.
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float cw = mix(0.32, 0.19, fl);   // šířka sloupce
    float H = mix(1.35, 1.1, fl);     // výška buňky (dráha kapky)
    float R = mix(0.036, 0.024, fl);  // základní poloměr
    float spd = mix(0.07, 0.09, fl);  // cyklů za sekundu
    float cx = floor(p.x / cw);
    for (int k = -1; k <= 1; k++) {
      float col = cx + float(k);
      float yc = p.y + hash(vec2(col, 3.7 + fl * 11.0)) * H;
      float row = floor(yc / H);
      float ly = yc - row * H;
      vec2 id0 = vec2(col + 17.0 * row, 5.0 * fl);
      float u = t * spd + hash(id0);
      float cyc = floor(u);
      float tau = u - cyc;
      vec2 id = id0 + vec2(0.0, cyc);
      float h1 = hash(id), h2 = hash(id + 7.7), h3 = hash(id + 3.3);
      // Trhaný sjezd: chvíli stojí, pak sklouzne kus dolů.
      float ns = 6.0 + 4.0 * h2;
      float s = tau * ns;
      float pp = (floor(s) + smoothstep(0.0, 0.35, fract(s))) / ns;
      float dy = mix(H - R * 1.5, R * 1.5, pp);
      float x0 = (col + 0.5 + (h1 - 0.5) * 0.3) * cw;
      float amp = cw * 0.12;
      float ph = h3 * 6.2831853;
      float grow = smoothstep(0.0, 0.06, tau) * (1.0 - smoothstep(0.9, 1.0, tau));
      float rs = max(R * (0.7 + 0.5 * h2) * grow, 1e-4);
      // Kapka kličkuje do stran podle výšky, stopa jde po stejné dráze.
      float wd = amp * sin(dy * 11.0 + ph) + amp * 0.5 * sin(dy * 23.0 + h1 * 20.0);
      vec2 n = vec2(p.x - (x0 + wd), ly - dy) / rs;
      float m = 1.0 - smoothstep(1.0 - px / rs, 1.0 + px / rs, length(n));
      if (m > mask) { mask = m; nrm = n; rad = rs; }

      float above = ly - dy;
      if (above > 0.0 && ly < H) {
        float tf = 1.0 - smoothstep(0.85, 1.0, tau);
        float tx = x0 + amp * sin(ly * 11.0 + ph) + amp * 0.5 * sin(ly * 23.0 + h1 * 20.0);
        float wc = rs * 0.9;
        float clr = (1.0 - smoothstep(wc * 0.6, wc, abs(p.x - tx)))
          * (1.0 - smoothstep(0.0, 0.7, above)) * tf * step(0.5, grow);
        clearK = max(clearK, clr);
        // Drobné kapičky ve stopě, postupně mizí.
        float tid = floor(ly / 0.05);
        float tfy = ly - (tid + 0.5) * 0.05;
        vec2 did = vec2(tid + col * 31.0 + fl * 7.0, cyc * 0.37 + 1.1);
        float g1 = hash(did), g2 = hash(did + 2.2), g3 = hash(did + 5.5);
        float fadeT = 1.0 - smoothstep(0.1, 0.55, above);
        float rd = max(rs * (0.1 + 0.15 * g2), 1e-4);
        float txd = x0 + amp * sin((tid + 0.5) * 0.05 * 11.0 + ph) + (g1 - 0.5) * rs * 0.6;
        vec2 n2 = vec2(p.x - txd, tfy) / rd;
        float m2 = (1.0 - smoothstep(1.0 - px / rd, 1.0 + px / rd, length(n2)))
          * step(g3, fadeT * 0.8) * tf * step((tid + 0.5) * 0.05, ly - rs) * step(above, 0.55);
        if (m2 > mask) { mask = m2; nrm = n2; rad = rd; }
      }
    }
  }

  // Drobné statické kapičky: jedna na buňku, pomalu se objevují a mizí, ve stopě chybí.
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float sc = mix(0.07, 0.035, fl);
    vec2 q = p / sc;
    vec2 id = floor(q) + fl * 17.3;
    vec2 f = fract(q);
    float h1 = hash(id), h2 = hash(id + 3.1), h3 = hash(id + 6.4), h4 = hash(id + 9.9);
    float life = smoothstep(0.1, 0.6, sin(6.2831853 * (t * 0.08 * (0.5 + h2) + h3)) * 0.5 + 0.5);
    float rs = max((0.1 + 0.18 * h4) * sc * life * (1.0 - clearK), 1e-4);
    vec2 n = (f - (0.5 + (vec2(h1, h2) - 0.5) * 0.4)) * sc / rs;
    float m = (1.0 - smoothstep(1.0 - px / rs, 1.0 + px / rs, length(n))) * step(0.4, h1 + h4 * 0.2);
    if (m > mask) { mask = m; nrm = n; rad = rs; }
  }

  // Pozadí za sklem: rozmazané bokeh skvrny. V kapce se vzorkuje s převráceným posunem a ostřeji.
  vec2 spos = p - nrm * rad * 2.5 * mask;
  float blur = mix(mix(0.9, 0.5, clearK), 0.12, mask);
  vec3 bg = mix(uColA, uColB, p.y) * 0.03;
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float bs = mix(0.21, 0.12, fl);
    vec2 q = spos / bs + vec2(fl * 5.3, fl * 2.1) + vec2(t * 0.01, t * 0.007);
    vec2 id = floor(q) + fl * 31.7;
    vec2 f = fract(q);
    float h1 = hash(id), h2 = hash(id + 9.1), h3 = hash(id + 19.3), hc = hash(id + 4.4);
    vec2 c = vec2(0.5) + (vec2(h1, h2) - 0.5) * 0.24
      + 0.05 * vec2(sin(t * 0.25 + h3 * 6.2831853), cos(t * 0.2 + h1 * 6.2831853));
    float r = 0.12 + 0.08 * h3;
    float e = 1.0 - smoothstep(r * (1.0 - blur), r * (1.0 + 0.3 * blur), length(f - c));
    vec3 lc = hc < 0.4 ? uColA : (hc < 0.8 ? uColB : mix(uColA, uColB, 0.5) * 1.2);
    float pul = 0.55 + 0.45 * sin(t * 0.5 * (0.5 + h2) + h3 * 6.2831853);
    bg += lc * e * pul * (0.5 + 0.5 * h1) * step(0.25, hash(id + 12.5)) * 0.9;
  }

  // Kapka: tmavší okraj, jasnější čočka a malý odlesk nahoře.
  float l = length(nrm);
  float rim = smoothstep(0.65, 1.0, l) * mask;
  vec3 col = bg * (1.0 - 0.55 * rim) * (1.0 + 0.25 * mask);
  float hl = 1.0 - smoothstep(0.0, 0.3, length(nrm - vec2(-0.35, 0.45)));
  col += vec3(0.7) * hl * mask;
  return col;`,
};
