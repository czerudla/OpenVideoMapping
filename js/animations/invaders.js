// Vesmírní vetřelci – pixelová formace pochoduje po krocích a klesá, dole jezdí dělo a střílí.
// Vše je čistá funkce času: zásahy jsou předurčené hashem (dělo míří pod náhodný sloupec
// a trefí nejnižšího žijícího vetřelce), po doběhnutí cyklu se formace obnoví.
// Pixely jsou čtvercové: velikost oblasti se odvodí z fwidth(vUV) / fwidth(vLocal).
// Bitové masky 11×8 (x = 0 je bit 0) se generují z textové předlohy, '#' je rozsvícený pixel.
const SQUID = [
  [
    '....###....',
    '...#####...',
    '..#######..',
    '.##.###.##.',
    '.#########.',
    '..#.#.#.#..',
    '.#.......#.',
    '..#.....#..',
  ],
  [
    '....###....',
    '...#####...',
    '..#######..',
    '.##.###.##.',
    '.#########.',
    '...#.#.#...',
    '..#.....#..',
    '.#.......#.',
  ],
];
const CRAB = [
  [
    '..#.....#..',
    '...#...#...',
    '..#######..',
    '.##.###.##.',
    '###########',
    '#.#######.#',
    '#.#.....#.#',
    '...##.##...',
  ],
  [
    '..#.....#..',
    '#..#...#..#',
    '#.#######.#',
    '###.###.###',
    '###########',
    '.#########.',
    '..#.....#..',
    '.#.......#.',
  ],
];
const OCTOPUS = [
  [
    '...#####...',
    '.#########.',
    '###########',
    '###..#..###',
    '###########',
    '..##...##..',
    '.##.###.##.',
    '##.......##',
  ],
  [
    '...#####...',
    '.#########.',
    '###########',
    '###..#..###',
    '###########',
    '...##.##...',
    '..##...##..',
    '...##.##...',
  ],
];
const BURST = [
  '#....#....#',
  '.#...#...#.',
  '..#..#..#..',
  '...#...#...',
  '##.......##',
  '##.......##',
  '..#..#..#..',
  '.#...#...#.',
];
const CANNON = [
  '...........',
  '.....#.....',
  '....###....',
  '....###....',
  '.#########.',
  '###########',
  '###########',
  '###########',
];

const toBits = (rows) => rows.map((r) => [...r].reduce((v, ch, x) => (ch === '#' ? v | (1 << x) : v), 0));
const INVADERS = [SQUID, CRAB, OCTOPUS].flatMap((frames) => frames.flatMap(toBits));
const ints = (a) => a.join(', ');

export default {
  id: 'invaders',
  group: 'games',
  name: 'Vesmírní vetřelci',
  colors: 2,
  glsl: `const float STEP = 0.5;   // doba jednoho kroku formace
  const int SH = 3;           // kroků mezi výstřely
  const float BSPEED = 2.4;   // rychlost střely v násobcích výšky za čas
  const float EXPL = 0.3;     // doba výbuchu
  const int SPR[48] = int[48](${ints(INVADERS)});
  const int BURST[8] = int[8](${ints(toBits(BURST))});
  const int CAN[8] = int[8](${ints(toBits(CANNON))});

  // Mřížka pixelů: velikost oblasti v prostoru se zachovaným poměrem stran, čtvercový pixel.
  vec2 bb = fwidth(vUV) / max(fwidth(vLocal), vec2(1e-9));
  float Wa = max(bb.x * uAspect, 1e-6);
  float Ha = max(bb.y, 1e-6);
  int C = clamp(int(floor((Wa / Ha * 100.0 - 21.0) / 14.0)), 8, 11);
  int Wf = C * 14 - 3;
  float u = min(Ha / 100.0, Wa / float(Wf + 24));
  float Wpx = Wa / u;
  float Hpx = Ha / u;
  vec2 pp = vLocal * vec2(Wpx, Hpx);
  ivec2 g = ivec2(floor(pp));

  // Dráha formace: vodorovné kroky (DX pixelů, S kroků na průchod), na okraji sestup o DY.
  float Rt = Wpx - float(Wf) - 8.0;
  int DX = max(2, int(ceil(Rt / 16.0)));
  int S = int(floor(Rt / float(DX)));
  float Rv = 0.7 * Hpx - 52.0;
  int DY = max(4, int(floor(Rv / 5.0)));
  int D = max(1, int(floor(Rv / float(DY))));
  int NS = (D + 1) * (S + 1);
  float cyc = float(NS + 2) * STEP;
  float cyf = floor(t / cyc);
  float tc = t - cyf * cyc;
  float seed = mod(cyf, 89.0) * 1.37 + 0.31;
  int nr = int(floor(tc / STEP));
  int n = min(nr, NS - 1);
  float cannonTop = floor(Hpx) - 9.0;
  float bulletSpeed = BSPEED * Hpx;

  // Krok s: poloha formace; výstřel j: krok, sloupec cíle a x děla v okamžiku výstřelu.
  #define FPOS(s) ((((s) / (S + 1)) % 2 == 0) ? ((s) % (S + 1)) : (S - (s) % (S + 1)))
  #define FOX(s) (4 + DX * FPOS(s))
  #define FOY(s) (4 + DY * ((s) / (S + 1)))
  #define SSTEP(j) (2 + (j) * SH)
  #define SCOL(j) min(int(floor(hash(vec2(float(j) + 0.5, seed)) * float(C))), C - 1)
  #define SX(j) (FOX(min(SSTEP(j), NS - 1)) + SCOL(j) * 14 + 5)

  float inkA = 0.0;
  float inkB = 0.0;

  // Formace: stav vetřelce (žije, vybuchuje, zmizel) určuje pořadí zásahů v jeho sloupci.
  ivec2 lc = g - ivec2(FOX(n), FOY(n));
  if (lc.x >= 0 && lc.y >= 0 && lc.x < C * 14 && lc.y < 50) {
    int c = lc.x / 14;
    int r = lc.y / 10;
    int px = lc.x - c * 14;
    int py = lc.y - r * 10;
    if (px < 11 && py < 8) {
      int b = 4 - r;
      float hitT = 1e9;
      int cnt = 0;
      for (int j = 0; j < 64; j++) {
        int s0 = SSTEP(j);
        if (s0 > NS - 1) break;
        if (SCOL(j) != c) continue;
        if (cnt == b) {
          float iy = float(FOY(s0) + r * 10 + 7);
          hitT = float(s0) * STEP + (cannonTop - iy) / bulletSpeed;
          break;
        }
        cnt++;
      }
      if (tc < hitT) {
        int ty = r == 0 ? 0 : (r < 3 ? 1 : 2);
        inkA = float((SPR[(ty * 2 + n % 2) * 8 + py] >> px) & 1);
      } else if (tc < hitT + EXPL) {
        inkA = float((BURST[py] >> px) & 1);
      }
    }
  }

  // Střela: letí celý v kroku, ve kterém byl výstřel, takže formace stojí.
  int J = nr >= 2 ? (nr - 2) / SH : -1;
  if (J >= 0 && nr == SSTEP(J) && nr <= NS - 1) {
    int cj = SCOL(J);
    int kb = 0;
    for (int i = 0; i < 64; i++) {
      if (i >= J) break;
      if (SCOL(i) == cj) kb++;
    }
    float yb = cannonTop - bulletSpeed * (tc - float(nr) * STEP);
    float stop = kb < 5 ? float(FOY(nr) + (4 - kb) * 10 + 7) : -4.0;
    int yi = int(floor(yb));
    if (yb > stop && g.x == SX(J) && g.y >= yi && g.y <= yi + 2) inkA = 1.0;
  }

  // Dělo: mezi výstřely hladce přejíždí pod další cíl.
  float xa = Wpx * 0.5;
  float ta = 0.0;
  if (J >= 0) {
    xa = float(SX(J));
    ta = float(SSTEP(J)) * STEP;
  }
  float xb = float(SX(J + 1));
  float tb = float(SSTEP(J + 1)) * STEP;
  float k = clamp((tc - ta - 0.2) / max(tb - ta - 0.2, 1e-3), 0.0, 1.0);
  int cl = int(floor(mix(xa, xb, smoothstep(0.0, 1.0, k)))) - 5;
  ivec2 cc = g - ivec2(cl, int(cannonTop));
  if (cc.x >= 0 && cc.y >= 0 && cc.x < 11 && cc.y < 8) {
    inkB = float((CAN[cc.y] >> cc.x) & 1);
  }

  return uColA * inkA + uColB * inkB * (1.0 - inkA);`,
};
