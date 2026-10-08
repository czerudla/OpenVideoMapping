// Kontrola knihovny animací: každý soubor z manifestu musí být platná animace.
// Spuštění: npm run check:animations
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ANIMATIONS_DIR, buildManifest } from './animations-manifest.js';

const errors = [];

const files = await buildManifest();

if (!existsSync(path.join(ANIMATIONS_DIR, 'solid.js'))) {
  errors.push('Chybí soubor solid.js (výchozí a záložní animace).');
}

const seen = new Map();
for (const f of files) {
  let a;
  try {
    a = (await import(pathToFileURL(path.join(ANIMATIONS_DIR, f)).href)).default;
  } catch (e) {
    errors.push(`Soubor ${f} nelze načíst: ${e.message}`);
    continue;
  }
  if (!a || typeof a !== 'object') {
    errors.push(`Soubor ${f} nemá výchozí export objektu.`);
    continue;
  }
  for (const key of ['id', 'name', 'colors', 'glsl']) {
    if (a[key] === undefined || a[key] === null || a[key] === '') {
      errors.push(`Soubor ${f}: chybí pole „${key}“.`);
    }
  }
  for (const key of ['id', 'name', 'glsl']) {
    if (a[key] !== undefined && a[key] !== null && a[key] !== '' && typeof a[key] !== 'string') {
      errors.push(`Soubor ${f}: pole „${key}“ musí být text.`);
    }
  }
  if (a.colors !== undefined && ![0, 1, 2].includes(a.colors)) {
    errors.push(`Soubor ${f}: pole „colors“ musí být 0, 1 nebo 2.`);
  }
  if (a.precompute !== undefined && typeof a.precompute !== 'function') {
    errors.push(`Soubor ${f}: pole „precompute“ musí být funkce.`);
  }
  if (a.id !== f.slice(0, -3)) {
    errors.push(`Soubor ${f}: id „${a.id}“ neodpovídá názvu souboru.`);
  }
  if (seen.has(a.id)) errors.push(`Soubor ${f}: duplicitní id „${a.id}“ (už je v ${seen.get(a.id)}).`);
  else seen.set(a.id, f);
}

if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`Kontrola animací selhala (${errors.length} chyb).`);
  process.exit(1);
}
console.log(`Kontrola animací v pořádku (${files.length} souborů).`);
