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
js/animations.js    knihovna animací v GLSL
js/homography.js    výpočet perspektivní transformace
js/state.js         model projektu a ukládání
server/serve.js     lokální server + most PJLink
```

Editor a výstup si stav předávají přes `BroadcastChannel`, takže musí běžet ve stejném prohlížeči.

## Jak přidat animaci

Do pole `ANIMATIONS` v `js/animations.js` přidejte záznam s tělem GLSL funkce, která vrací barvu:

```js
{
  id: 'blink', name: 'Mrkání', colors: 2,
  glsl: `return mix(uColB, uColA, step(0.9, fract(t)));`,
},
```

K dispozici jsou `vUV` (poloha v celé ploše 0–1), `vLocal` (poloha v rámci oblasti 0–1), `t` (čas násobený rychlostí), `uColA`, `uColB`, `uAspect` a funkce `hsv2rgb`, `hash`, `noise`, `fbm`.

## Možná další rozšíření

- video a obrázky jako výplň oblastí,
- mřížkový warp pro zakřivené plochy,
- časová osa a scény,
- ovládání přes MIDI (Web MIDI API) nebo z mobilu.
