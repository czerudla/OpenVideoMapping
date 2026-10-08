# CLAUDE.md

Pokyny pro agenty (zadání, vývoj, review), kteří pracují na OpenVideoMapping.
Repozitář: https://github.com/czerudla/OpenVideoMapping, hlavní větev `master`.

## O projektu

Webový nástroj pro projekční mapping. V editoru (`index.html`) uživatel kreslí polygonové oblasti, přiřazuje jim GLSL animace a nastavuje perspektivní warp. Výstupní okno (`output.html`) běží fullscreen na projektoru a vykresluje totéž. Mimo oblasti musí být vždy čistá černá (RGB 0, 0, 0). To je klíčový požadavek, nikdy ho neporušuj.

Uživatelská dokumentace je v `README.md`.

## Spuštění

```
npm start          # node server/serve.js, http://localhost:8080
```

- Node.js 18+, **žádné npm závislosti**. Čistý ES modules JavaScript, bez build kroku, bez frameworku, bez TypeScriptu.
- Novou závislost (i dev) přidej jen tehdy, když to zadání výslovně povoluje.
- Automatické testy zatím neexistují. Dokud nebudou, ověř změnu aspoň takto: `node --check` na každý změněný JS soubor, spuštění serveru a načtení `/` i `/output.html` bez chyb v konzoli. V PR popiš, jak jsi změnu ověřil.
- CI (`.github/workflows/ci.yml`, job `Kontroly`) u každého PR do `master` spouští `node --check` na všechny `*.js` v `js/`, `server/` a `scripts/` a `npm run check:animations`. Tytéž příkazy spusť lokálně před pushem.

## Architektura

```
index.html          editor (UI, panely)
output.html         výstup pro projektor
css/style.css       vzhled editoru
js/app.js           logika editoru: nástroje, kreslení, úpravy bodů, warp, undo/redo, UI panely, PJLink
js/output.js        výstupní okno: fullscreen, wake lock, hlášení rozlišení editoru
js/renderer.js      WebGL2 renderer (stencil maska oblastí + perspektivní transformace)
js/shaders.js       sdílený kód shaderů (VERTEX_SHADER, FRAGMENT_HEADER, CALIBRATION_GLSL, buildFragment)
js/animations/      jedna animace na soubor (<id>.js) + registr index.js (ANIMATIONS, getAnimation)
scripts/check-animations.js  kontrola animací vs. registr (npm run check:animations)
js/homography.js    homografie 3×3 (řádkové pořadí), inverze, test konvexity
js/state.js         model projektu, normalizace, ukládání do localStorage
server/serve.js     statický server + most PJLink (POST /api/pjlink)
```

Upravuj jen soubory v `js/`. Kořenové kopie neměň a nemaž je, pokud to zadání výslovně nepožaduje.

### Klíčové koncepty

- **Souřadnice:** body oblastí (`shape.points`) jsou v prostoru obsahu 0–1. `state.corners` jsou 4 rohy warpu v prostoru obrazovky 0–1, v pořadí LH, PH, PD, LD. Homografie `squareToQuad(corners)` převádí obsah na obrazovku. Warp musí zůstat konvexní (`isConvexQuad`).
- **Stav:** jediný objekt `state` (viz `createDefaultState` v `state.js`). Každá změna stavu v editoru jde přes `commit()`, které ho rozešle výstupu a s debounce uloží. Před uživatelskou změnou volej `snapshot()`, jinak nebude fungovat undo.
- **Komunikace editor ↔ výstup:** `BroadcastChannel('videomapping')`, zprávy `{type:'state'}`, `{type:'hello'}` a `{type:'screen', w, h, fullscreen}`. Výstup je pasivní, jen vykresluje přijatý stav.
- **Perzistence a kompatibilita:** projekty v localStorage (`videomapping.project.v1`) a exportované JSON soubory se musí dát načíst i po změně. Nová pole přidávej s výchozí hodnotou do `createDefaultState` a `normalizeState`. Při nekompatibilní změně zvyš `version` a doplň migraci do `normalizeState`, starý formát nikdy nezahazuj.
- **Animace:** nová animace je nový soubor `js/animations/<id>.js` s výchozím exportem `{id, name, colors, glsl}` (`id` = název souboru) a import + řádek v `js/animations/index.js`. Před PR spusť `npm run check:animations`. Dostupné proměnné a funkce jsou popsané v README. `id` existující animace neměň, ukládá se do projektů.
- **Server:** naslouchá jen na `127.0.0.1`. PJLink most přeposílá pouze příkazy ze seznamu `ALLOWED` a validuje host. Tato bezpečnostní omezení nesmí žádná změna oslabit.

## Konvence kódu

- Moderní ES2022, `import`/`export`, 2 mezery, středníky, jednoduché uvozovky, malé funkce bez tříd (kromě `Renderer`).
- Komentáře, texty v UI a chybové hlášky jsou **česky**. Identifikátory jsou anglicky.
- Klávesové zkratky a ovládání drž v souladu s tabulkou v README. Když něco přidáš nebo změníš, aktualizuj README ve stejném PR.
- Výkon: render smyčka běží každý snímek, v `frame()`/`render()` nealokuj zbytečně a nekompiluj shadery.
- Podporované prohlížeče: aktuální Chrome a Edge (primárně), Firefox.

## Workflow agentů

Průběh řídí GitHub Issues a labely. O schválení vždy rozhoduje člověk (Ladislav).

| Label | Význam |
|---|---|
| `idea` | surový nápad, ještě nerozpracovaný |
| `spec-ready` | zadání je hotové a čeká na schválení člověkem |
| `approved` | schváleno člověkem, vývojový agent může začít (dává jen člověk) |
| `in-progress` | vývojový agent na issue pracuje |
| `review-ok` / `changes-requested` | výsledek review agenta na PR |
| `needs-human` | agent si neví rady nebo proběhla 3 kola review bez shody |

### Agent pro zadání

- Z nápadu udělej issue v tomto tvaru: **Cíl** (proč), **Popis chování**, **Akceptační kritéria** (ověřitelný checklist), **Dotčené soubory**, **Mimo rozsah**, **Otevřené otázky**.
- Jedno issue odpovídá jednomu PR. Větší nápad rozděl na menší issues a propoj je („závisí na #N“).
- Nastav label `spec-ready`. Label `approved` nikdy nenastavuj.

### Vývojový agent

- Pracuj jen na issues s labelem `approved`. Nastav `in-progress`, víc než 2 issues současně nerozpracovávej.
- Větev `issue-<číslo>-<krátký-popis>`, malé commity, zprávy commitů česky v rozkazovacím způsobu.
- PR: název podle issue, v popisu `Closes #<číslo>`, co se změnilo, jak to bylo ověřeno a odškrtnutá akceptační kritéria.
- Drž se rozsahu zadání, žádné nesouvisející refaktory. Když zadání nestačí, zeptej se komentářem v issue a nastav `needs-human`.
- Nikdy nepushuj přímo do `master` a nikdy nemerguj. Merge provede GitHub (auto-merge) po schválení člověkem a po úspěšném review.

### Review agent

- Zkontroluj PR proti akceptačním kritériím issue a proti tomuto souboru: správnost, černá mimo oblasti, kompatibilita uložených projektů, bezpečnost serveru, výkon render smyčky, aktuálnost README.
- Nálezy piš konkrétně (soubor, řádek, proč, návrh opravy) a odliš blokující od drobných.
- Výsledek: label `review-ok`, nebo `changes-requested` s výčtem blokujících nálezů. Po 3 kolech bez shody nastav `needs-human`.
