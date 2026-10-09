// Had (Snake) ze starých Nokií leze po obvodu oblasti po políčkách, sbírá jídlo a roste; po nárazu do ocasu se rozpadne a hra začne znovu.
export default {
  id: 'snake',
  name: 'Had (Snake)',
  colors: 2,
  glsl: `const float SPEED = 0.25;
  const float START_LEN = 4.0;
  const float MAX_FOOD = 38.0;
  const float BLINK = 1.5;
  const float BREAK = 1.0;
  const float PAUSE = 0.5;
  vec2 A = vec2(uAspect, 1.0);

  // Rozměry oblasti a orientace polygonu (znaménko plochy určuje, kde je vnitřek).
  vec2 lo = vec2(1e9);
  vec2 hi = vec2(-1e9);
  float area = 0.0;
  for (int i = 0; i < MAX_POLY; i++) {
    if (i >= uPolyCount) break;
    vec2 a = polyV(i);
    vec2 b = polyV(polyNext(i));
    lo = min(lo, a);
    hi = max(hi, a);
    area += a.x * b.y - a.y * b.x;
  }
  float side = area >= 0.0 ? 1.0 : -1.0;
  float per = max(polyPerimeter(), 0.001);

  // Políčko je zhruba 1,5 % menšího rozměru plochy, obvod se dělí na celý počet políček.
  float cell0 = max(0.015 * min(hi.x - lo.x, hi.y - lo.y), 0.0005);
  float N = max(floor(per / cell0 + 0.5), 12.0);
  float cell = per / N;
  float hs = 0.4 * cell;
  float inset = hs * 1.05;
  float maxLen = N - 2.0;
  float grow = max(1.0, ceil((maxLen - START_LEN) / MAX_FOOD));

  // Hra: jídlo je vždy o 3 až 10 políček před hlavou, po snězení had povyroste.
  float sps = SPEED / cell;
  float E = 0.0;
  float len = START_LEN;
  for (int k = 0; k < 40; k++) {
    if (len >= maxLen) break;
    float d = max(1.0, min(3.0 + floor(hash(vec2(float(k), 7.0)) * 8.0), N - len));
    E += d;
    len = min(START_LEN + grow * float(k + 1), maxLen);
  }
  float steps = E + 2.0;
  float playT = steps / sps;
  float ph = mod(t, playT + BLINK + BREAK + PAUSE);
  float n = min(floor(ph * sps), steps);

  // Stav hry v kroku n: délka hada a políčko jídla (-1 = žádné).
  E = 0.0;
  len = START_LEN;
  float food = -1.0;
  for (int k = 0; k < 40; k++) {
    if (len >= maxLen) break;
    float d = max(1.0, min(3.0 + floor(hash(vec2(float(k), 7.0)) * 8.0), N - len));
    if (n < E + d) { food = E + d; break; }
    E += d;
    len = min(START_LEN + grow * float(k + 1), maxLen);
  }

  // Konec hry: 3x probliknutí, pak se segmenty náhodně ztrácejí.
  float over = ph - playT;
  float vis = 1.0;
  float crumble = 0.0;
  if (over > 0.0) {
    vis = step(fract(over / (BLINK / 3.0)), 0.5);
    if (over > BLINK) { vis = 1.0; crumble = (over - BLINK) / BREAK; }
    if (over > BLINK + BREAK) vis = 0.0;
    food = -1.0;
  }

  vec3 col = vec3(0.0);
  vec3 headCol = mix(uColA, vec3(1.0), 0.45);
  float aa = 0.0015;
  float arc = polyArc(vUV);
  float k0 = floor(arc / cell);
  vec2 q = vUV * A;

  // Tři nejbližší políčka dráhy; střed leží na obvodu posunutém dovnitř o půl tloušťky.
  for (int k = 0; k < 3; k++) {
    float j = k0 + float(k - 1);
    float c = mod(j, N);
    float age = mod(n - c, N);
    bool body = age < len;
    bool isFood = c == mod(food, N) && food >= 0.0;
    if (!body && !isFood) continue;
    float s = (j + 0.5) * cell;
    vec2 p0 = polyPoint(s) * A;
    float W = max(0.01, inset * 1.5);
    vec2 t1 = p0 - polyPoint(s - W) * A;
    vec2 t2 = polyPoint(s + W) * A - p0;
    t1 /= max(length(t1), 1e-6);
    t2 /= max(length(t2), 1e-6);
    vec2 n1 = side * vec2(-t1.y, t1.x);
    vec2 n2 = side * vec2(-t2.y, t2.x);
    vec2 nm = n1 + n2;
    nm = length(nm) > 1e-4 ? normalize(nm) : n2;
    vec2 ctr = p0 + nm * inset / clamp(dot(nm, n2), 0.35, 1.0);
    vec2 d = q - ctr;
    float u = dot(d, t2);
    float v = dot(d, n2);
    float box = 1.0 - smoothstep(hs - aa, hs, max(abs(u), abs(v)));
    if (body) {
      float show = vis * step(crumble, hash(vec2(c, 3.0)));
      vec3 sc = age < 0.5 ? headCol : uColA;
      col = mix(col, sc, box * show);
      if (age < 0.5) {
        // Oči hlavy.
        float eye = 1.0 - smoothstep(0.09 * cell - aa, 0.09 * cell, length(vec2(u - 0.12 * cell, abs(v) - 0.18 * cell)));
        col = mix(col, vec3(0.0), eye * show);
      }
    } else {
      col = mix(col, uColB, box * step(0.4, fract(t * 3.0)));
    }
  }
  return col;`,
};
