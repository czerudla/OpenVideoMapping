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
5. Nástrojem **Kreslit** obkreslete objekty, na které chcete svítit, a každé oblasti vyberte animaci.

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
  colors: 2,
  glsl: `return mix(uColB, uColA, step(0.9, fract(t)));`,
};
```

2. Spusťte `npm run check:animations`, který ověří všechny soubory animací. Nic dalšího se nepřidává ani needituje: seznam animací se skládá automaticky (server ho generuje za běhu jako `/js/animations/manifest.json`, pro statický hosting ho vytvoří `npm run build:manifest`). Po obnovení stránky je animace v nabídce. V nabídce je první `solid`, ostatní jsou seřazené podle názvu.

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

## Možná další rozšíření

- video a obrázky jako výplň oblastí,
- mřížkový warp pro zakřivené plochy,
- časová osa a scény,
- ovládání přes MIDI (Web MIDI API) nebo z mobilu.
