// Kontrola knihovny animací: každý soubor z manifestu musí být platná animace.
// Spuštění: npm run check:animations
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ANIMATIONS_DIR, buildManifest } from './animations-manifest.js';
import { ANIMATION_GROUPS } from '../js/animation-groups.js';
import { SIM_FORMATS } from '../js/sim-utils.js';

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
  if (a.group === undefined || a.group === null || a.group === '') {
    errors.push(`Soubor ${f}: chybí pole „group“.`);
  } else if (!ANIMATION_GROUPS.some((g) => g.id === a.group)) {
    errors.push(`Soubor ${f}: neznámá skupina „${a.group}“ (platné skupiny jsou v js/animation-groups.js).`);
  }
  if (a.precompute !== undefined && typeof a.precompute !== 'function') {
    errors.push(`Soubor ${f}: pole „precompute“ musí být funkce.`);
  }
  if (a.sim !== undefined) {
    if (!a.sim || typeof a.sim !== 'object') {
      errors.push(`Soubor ${f}: pole „sim“ musí být objekt.`);
    } else {
      for (const fn of ['size', 'init', 'step']) {
        if (typeof a.sim[fn] !== 'function') errors.push(`Soubor ${f}: pole „sim.${fn}“ musí být funkce.`);
      }
      for (const key of ['stepsPerSecond', 'stepsPerCycle']) {
        const v = a.sim[key];
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          errors.push(`Soubor ${f}: pole „sim.${key}“ musí být kladné číslo.`);
        }
      }
      if (a.sim.format !== undefined && !SIM_FORMATS.includes(a.sim.format)) {
        errors.push(`Soubor ${f}: pole „sim.format“ musí být ${SIM_FORMATS.map((x) => `„${x}“`).join(', ')}.`);
      }
    }
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
