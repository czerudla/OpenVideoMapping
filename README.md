# OpenVideoMapping

Webový nástroj pro projekční mapping. Nakreslíte oblasti, přiřadíte jim animace a výstupní okno je promítá dataprojektorem. Mimo oblasti se vykresluje čistá černá (RGB 0, 0, 0).

## Spuštění

Potřebujete Node.js 18 nebo novější. Žádné další balíčky se neinstalují.

```
npm start
```

Pak otevřete http://localhost:8080 v Chrome nebo Edge. Firefox funguje také, jen neumí otevřít výstup rovnou na druhém displeji.

1. Připojte projektor jako druhý displej (rozšířená plocha, ne zrcadlení) a nastavte ho na nativní rozlišení se škálováním 100 %.
2. V editoru klikněte na **Otevřít výstup**. Chrome se zeptá na oprávnění ke správě oken; po povolení se výstup otevře přímo na projektoru.
3. Ve výstupním okně klikněte nebo stiskněte F a přepne se na celou obrazovku. Editor převezme rozlišení projektoru automaticky.
4. Zapněte **Kalibraci**, zvolte **Warp** a tažením rohů srovnejte mřížku s promítanou plochou.
5. Nástrojem **Kreslit** obkreslete objekty, na které chcete svítit, a každé oblasti vyberte skupinu a v ní animaci.

Projekt se průběžně ukládá do prohlížeče. Tlačítkem **Uložit do souboru** ho zálohujete jako JSON.

## Ovládání

| Klávesa | Akce |
|---|---|
| V / D / W | Vybrat / Kreslit / Warp |
| Enter | Uzavřít kreslený tvar |
| Backspace | Při kreslení vrátí poslední bod, jinak smaže oblast |
| Esc | Zrušit kreslení nebo výběr |
| Šipky (+ Shift) | Posun oblasti nebo bodu pod kurzorem o 1 (10) px |
| Dvojklik na hranu | Přidat bod |
| Pravé tlačítko na bodu | Odebrat bod |
| C | Kalibrační mřížka |
| B | Blackout |
| Ctrl+Z / Ctrl+Shift+Z | Zpět / Znovu |
| Ctrl+D | Duplikovat vybranou oblast |

## Černá mimo oblasti

Projektor nedokáže vypnout jednotlivé pixely, černá je jeho fyzické minimum. Pro co nejtmavší okolí:

- použijte projektor s vysokým nativním kontrastem (laserový DLP nebo LCoS),
- vypněte v menu projektoru dynamický kontrast a snižte jas na nutné minimum,
- místa, kam nikdy nesvítíte, zakryjte fyzickou maskou před objektivem.

Tlačítka **Zavřít závěrku / Otevřít závěrku** posílají projektoru příkaz PJLink (`AVMT 31` / `AVMT 30`), který zastaví světlo celého obrazu. PJLink je nutné zapnout v síťovém menu projektoru. Příkazy prochází lokálním serverem `server/serve.js`, protože prohlížeč neumí otevřít přímé TCP spojení; server přijímá požadavky jen z tohoto počítače a přeposílá pouze pevně povolené příkazy.

## Struktura

```
index.html          editor
output.html         výstup pro projektor
css/style.css       vzhled editoru
js/app.js           logika editoru (kreslení, úpravy, warp, historie)
js/output.js        výstupní okno, fullscreen, hlášení rozlišení
js/renderer.js      WebGL2 vykreslování (stencil maska + perspektiva)
js/shaders.js       sdílený kód shaderů (vertex, hlavička fragmentu, kalibrace)
js/animations/      animace, jedna na soubor (<id>.js); index.js je načte podle manifestu
js/animation-groups.js  skupiny animací (pořadí v editoru)
scripts/            manifest animací (animations-manifest.js, build-animations-manifest.js), check-animations.js
js/homography.js    výpočet perspektivní transformace
js/state.js         model projektu a ukládání
server/serve.js     lokální server + most PJLink
```

Editor a výstup si stav předávají přes `BroadcastChannel`, takže musí běžet ve stejném prohlížeči.

## Jak přidat animaci

1. Vytvořte soubor `js/animations/<id>.js` (název souboru se musí shodovat s `id`) s tělem GLSL funkce, která vrací barvu:

```js
// Mrkání – krátké probliknutí barvy A.
export default {
  id: 'blink',
  name: 'Mrkání',
  group: 'basic',
  colors: 2,
  glsl: `return mix(uColB, uColA, step(0.9, fract(t)));`,
};
```

2. Spusťte `npm run check:animations`, který ověří všechny soubory animací. Nic dalšího se nepřidává ani needituje: seznam animací se skládá automaticky (server ho generuje za běhu jako `/js/animations/manifest.json`, pro statický hosting ho vytvoří `npm run build:manifest`). Po obnovení stránky je animace v nabídce. V nabídce je první `solid`, ostatní jsou seřazené podle názvu.

`group` je povinné `id` skupiny. V editoru se nejdřív vybere skupina („Skupina“) a potom animace z ní („Animace“); změna skupiny hned přiřadí oblasti první animaci skupiny (jde vrátit jedním Ctrl+Z). Prázdné skupiny se nezobrazují. Skupina se neukládá do projektu, odvozuje se z animace. Animace bez `group` nebo s neznámou skupinou se zařadí do skupiny „Ostatní“ s chybou v konzoli a `npm run check:animations` skončí chybou.

| `id` | Skupina | Obsah |
|---|---|---|
| `basic` | Základní | jednoduché barevné a pohybové efekty |
| `outline` | Obrysy a hrany | efekty sledující obvod a hrany oblasti |
| `nature` | Příroda a živly | oheň, voda, obloha, počasí, kouř |
| `show` | Show a oslavy | velké efektní momenty na akce |
| `retro` | Retro a popkultura | pocty filmům, televizi a počítačům |
| `games` | Hry | automaticky hrané hry |
| `sim` | Simulace | simulace a algoritmy |
| `automata` | Buněčné automaty | Hra života a příbuzné automaty |

Skupiny jsou definované v `js/animation-groups.js`. Novou skupinu přidáte tam jedním záznamem `{ id, name }` na požadované místo v poli (pořadí určuje pořadí v editoru). Je to vědomé rozhodnutí, seznam se mění zřídka; doplňte ji i do tabulky výše.

`colors` je počet barev, které animace používá (0–2). `id` je neměnné, ukládá se do projektů. Vadný záznam se při načtení vypíše do konzole a vynechá, ostatní animace fungují dál.

K dispozici jsou `vUV` (poloha v celé ploše 0–1), `vLocal` (poloha v rámci oblasti 0–1), `t` (čas násobený rychlostí), `uColA`, `uColB`, `uAspect` a funkce `hsv2rgb`, `hash`, `noise`, `fbm`.

Animace může pracovat i s tvarem oblasti. Vrcholy polygonu jsou v `uPoly[MAX_POLY]` (souřadnice jako `vUV`, `MAX_POLY` = 64) a jejich počet v `uPolyCount`. Oblast s více než 64 body se do shaderu pošle zjednodušená (každý k-tý bod), maska zůstává přesná. Funkce počítají v prostoru se zachovaným poměrem stran, takže vzdálenosti jsou ve všech směrech stejné:

| Funkce | Význam |
|---|---|
| `float polyDist(vec2 uv)` | znaménková vzdálenost k hranici oblasti, uvnitř záporná (funguje i pro nekonvexní tvary) |
| `float polyPerimeter()` | délka obvodu |
| `float polyArc(vec2 uv)` | poloha nejbližšího bodu hranice měřená po obvodu od prvního vrcholu (0 až `polyPerimeter()`) |
| `vec2 polyPoint(float s)` | bod na obvodu ve vzdálenosti `s` po obvodu, v souřadnicích `vUV` |

Příklad zvýraznění hrany: `return uColA * smoothstep(0.02, 0.0, abs(polyDist(vUV)));`

### Předvýpočet dat z tvaru oblasti (`precompute`)

Některé efekty (např. odraz od hran nepravidelného polygonu) nejdou spočítat v shaderu jako čistá funkce času. Animace proto může volitelně exportovat `precompute(points, aspect)`:

```js
export default {
  id: 'centroid', name: 'Těžiště', colors: 1,
  // points: body oblasti v prostoru 0–1, aspect: poměr stran plochy
  precompute(points, aspect) {
    const n = points.length;
    const cx = points.reduce((s, p) => s + p[0], 0) / n;
    const cy = points.reduce((s, p) => s + p[1], 0) / n;
    return new Float32Array([cx, cy, 0, 0]); // jeden vec4 záznam
  },
  glsl: `float d = length((vUV - uData[0].xy) * vec2(uAspect, 1.0));
  return uDataCount > 0 ? uColA * step(d, 0.02) : vec3(0.0);`,
};
```

- Funkce se volá jen při změně bodů oblasti, animace nebo poměru stran, nikdy v render smyčce. Výsledek se uloží do cache podle `shape.id`.
- Musí vrátit `Float32Array` s nejvýše `4 * MAX_DATA` čísly (`MAX_DATA` = 64), tedy vec4 záznamy, a musí být deterministická (editor i výstup počítají každý zvlášť).
- Shader dostane `uniform vec4 uData[MAX_DATA]` a `uniform int uDataCount` (počet platných záznamů). Animace bez `precompute` mají `uDataCount = 0`.
- Výjimka nebo neplatný výsledek se vypíše do konzole a oblast se vykreslí s `uDataCount = 0`.
- Hook je jen pro geometrii, ne pro simulaci závislou na čase.

### Stavové animace (`sim`)

Efekty, které se vyvíjejí krok za krokem (buněčné automaty, písek, had), potřebují stav. Animace proto může volitelně exportovat `sim`, krokovou simulaci v JS nad malou mřížkou. Renderer ji předá shaderu jako texturu:

```js
export default {
  id: 'bar', name: 'Posuvný pruh', colors: 1,
  sim: {
    size(points, aspect) { return { w: 32, h: 18 }; }, // nejvýše 256 × 256, volá se při změně tvaru/poměru stran
    stepsPerSecond: 8,   // kroky simulace za sekundu času t (včetně rychlosti oblasti)
    stepsPerCycle: 64,   // po tolika krocích se simulace znovu inicializuje
    // grid: Uint8Array w*h (vynulované), zapisuje se do něj; seed je deterministický
    init(grid, w, h, seed, points, aspect) { grid[0] = 255; },
    // čte src, zapisuje dst (obě Uint8Array w*h); stepIndex je pořadí kroku v rámci cyklu
    step(src, dst, w, h, stepIndex) { dst.fill(0); dst[(stepIndex + 1) % w] = 255; },
  },
  glsl: `vec2 g = floor(vLocal * uStateSize);
  float v = uStateSize.x > 0.0 ? texture(uState, (g + 0.5) / uStateSize).r : 0.0;
  return uColA * v;`,
};
```

- Shader dostane `uniform sampler2D uState` (R8, hodnota 0–255 na buňku, `NEAREST`, `CLAMP_TO_EDGE`), `uniform vec2 uStateSize` (`w`, `h`; 0, pokud animace nemá `sim` nebo simulace selhala) a `uniform float uStateFrac` (0–1, poloha mezi aktuálním a dalším krokem pro plynulé přechody).
- Stav je deterministický a odvozený z času: krok `n = floor(t * stepsPerSecond)`, cyklus `floor(n / stepsPerCycle)`. Editor i výstupní okno simulují každé zvlášť, ale ukazují totéž, i po obnovení stránky. `init` a `step` proto musí být deterministické (žádné `Math.random()` ani `Date.now()`, používejte `seed` a `stepIndex`).
- Mřížka je nejvýše 256 × 256 buněk. Pole `src`/`dst` i textura se alokují předem, `init` a `step` by neměly alokovat nic velkého.
- Simulace všech oblastí smí za snímek zabrat nejvýše ~4 ms. Zbývající kroky se dopočítají v dalších snímcích, takže stav může po načtení stránky nebo skoku rychlosti krátce „dobíhat“. Při změně cyklu se rovnou volá `init`.
- Výjimka v `size`, `init` nebo `step` se vypíše do konzole (jednou), simulace se pro oblast vypne (`uStateSize = 0`) a oblast se dál vykresluje.
- `npm run check:animations` ověří, že `sim` má funkce `size`, `init`, `step`, kladná čísla `stepsPerSecond` a `stepsPerCycle` a platný `format`.
- **Veškerý stav simulace musí být v polích `src`/`dst`**, ne v proměnných modulu ani v uzávěru. Jedna animace může běžet ve více oblastech současně a modul je sdílený, takže by se stav mezi oblastmi míchal a nedal by se obnovit při dobíhání od začátku cyklu. Předalokované pomocné buffery v modulu jsou povolené jen jako dočasná paměť v rámci jednoho volání `step` (např. fronta pro BFS). Když stav potřebuje víc než jeden bajt na buňku, použijte `rgba8` nebo `rgba32f`, případně vyhrazený řádek mřížky.

#### Formát stavu (`sim.format`)

Volitelné pole `format` určuje typ pole i textury (výchozí je `'r8'`, starší animace se nemění):

| `format` | pole v JS | textura | použití |
|---|---|---|---|
| `'r8'` (výchozí) | `Uint8Array(w*h)` | `R8` | buněčné automaty |
| `'rgba8'` | `Uint8Array(w*h*4)` | `RGBA8` | víc malých hodnot na buňku |
| `'rgba32f'` | `Float32Array(w*h*4)` | `RGBA32F` | fyzika (vlny, difuze), agenti |

- Pro `rgba*` je hodnota buňky `(x, y)` na indexu `(y*w + x)*4 + kanál` (kanály R, G, B, A = 0–3). `init` a `step` dostávají pole odpovídajícího typu a délky.
- Textura je vždy `NEAREST` a `CLAMP_TO_EDGE`, ve shaderu zůstává `uniform sampler2D uState`. Pro `r8` a `rgba8` se čte rozsah 0–1, pro `rgba32f` přímo hodnoty float (i záporné).
- Neplatný `format` vypíše registr do konzole (animace se vynechá) a `check:animations` skončí českou chybou.
- Hladké hodnoty ze stavu se interpolují ve shaderu přes `texelFetch` (lineární filtrování float textur se nepoužívá). Bilineární vzorkování buňkových středů:

```glsl
vec4 stateBilinear(vec2 uv) {          // uv = vLocal (0–1 v oblasti)
  vec2 p = uv * uStateSize - 0.5;
  vec2 i = floor(p), f = p - i;
  ivec2 hi = ivec2(uStateSize) - 1;
  ivec2 a = clamp(ivec2(i), ivec2(0), hi);
  ivec2 b = clamp(ivec2(i) + 1, ivec2(0), hi);
  return mix(mix(texelFetch(uState, ivec2(a.x, a.y), 0), texelFetch(uState, ivec2(b.x, a.y), 0), f.x),
             mix(texelFetch(uState, ivec2(a.x, b.y), 0), texelFetch(uState, ivec2(b.x, b.y), 0), f.x), f.y);
}
```

#### Agenti v textuře

Agentní simulace (hejno) ukládají každého agenta do jednoho texelu. `size()` vrátí `{ w: N, h: 1 }`, formát je `'rgba32f'` a texel obsahuje `x, y, vx, vy`. Shader prochází agenty ve smyčce s pevnou mezí:

```glsl
const int MAX_AGENTS = 128;
float d = 1e9;
for (int i = 0; i < MAX_AGENTS; i++) {
  if (i >= int(uStateSize.x)) break;
  vec4 a = texelFetch(uState, ivec2(i, 0), 0);   // x, y, vx, vy v prostoru 0–1 oblasti
  d = min(d, length((vLocal - a.xy) * vec2(uAspect, 1.0)));
}
return uColA * (1.0 - smoothstep(0.01, 0.015, d));
```

#### Sdílené funkce `js/sim-utils.js`

Modul leží mimo `js/animations/`, takže ho manifest nenačítá jako animaci. Animace z něj importují (`import { createRandom } from '../sim-utils.js';`):

- `createRandom(seed)` – deterministický generátor (mulberry32), vrací funkci `() => [0, 1)`.
- `gridSize(points, aspect, longSide)` – `{ w, h }` mřížky se čtvercovými buňkami přes ohraničující obdélník oblasti, `longSide` buněk na delší straně (nejvýše 256).
- `polygonMask(points, aspect, w, h, out)` – do `out` (`Uint8Array(w*h)`) zapíše 1 pro buňky, jejichž střed leží uvnitř polygonu, jinak 0. Mřížka odpovídá `vLocal`.
- `boundaryCells(mask, w, h, out)` – označí buňky uvnitř masky sousedící s okrajem masky nebo mřížky (pro animace rostoucí od hran).

Funkce jsou čisté a deterministické a při zadaném `out` nealokují.

## Možná další rozšíření

- video a obrázky jako výplň oblastí,
- mřížkový warp pro zakřivené plochy,
- časová osa a scény,
- ovládání přes MIDI (Web MIDI API) nebo z mobilu.
