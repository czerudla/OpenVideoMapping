// Registr animací. Seznam souborů dodává manifest (generuje ho server nebo `npm run build:manifest`),
// takže nová animace = jen nový soubor <id>.js v této složce.
import solid from './solid.js';
import { SIM_FORMATS } from '../sim-utils.js';

const REQUIRED = ['id', 'name', 'colors', 'glsl'];
const FILE_RE = /^[a-z0-9-]+\.js$/;

// Vrátí českou chybu pro neplatné `sim`, nebo null.
function validateSim(sim) {
  if (!sim || typeof sim !== 'object') return 'pole „sim“ musí být objekt';
  for (const fn of ['size', 'init', 'step']) {
    if (typeof sim[fn] !== 'function') return `pole „sim.${fn}“ musí být funkce`;
  }
  for (const key of ['stepsPerSecond', 'stepsPerCycle']) {
    if (typeof sim[key] !== 'number' || !Number.isFinite(sim[key]) || sim[key] <= 0) {
      return `pole „sim.${key}“ musí být kladné číslo`;
    }
  }
  if (sim.format !== undefined && !SIM_FORMATS.includes(sim.format)) {
    return `pole „sim.format“ musí být ${SIM_FORMATS.map((f) => `„${f}“`).join(', ')}`;
  }
  return null;
}

// Vrátí českou chybu, nebo null, pokud je záznam v pořádku.
function validate(a, seen) {
  if (!a || typeof a !== 'object') return 'záznam není objekt';
  for (const key of REQUIRED) {
    if (a[key] === undefined || a[key] === null || a[key] === '') return `chybí pole „${key}“`;
  }
  if (typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.glsl !== 'string') {
    return 'pole id, name a glsl musí být text';
  }
  if (a.precompute !== undefined && typeof a.precompute !== 'function') {
    return 'pole „precompute“ musí být funkce';
  }
  if (a.sim !== undefined) {
    const err = validateSim(a.sim);
    if (err) return err;
  }
  if (![0, 1, 2].includes(a.colors)) return 'pole „colors“ musí být 0, 1 nebo 2';
  if (seen.has(a.id)) return `duplicitní id „${a.id}“`;
  return null;
}

async function loadManifest() {
  const res = await fetch(new URL('./manifest.json', import.meta.url));
  if (!res.ok) throw new Error(`stavový kód ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('manifest není pole');
  return list;
}

async function loadAll() {
  let files;
  try {
    files = await loadManifest();
  } catch (e) {
    const msg = `Manifest animací se nepodařilo načíst (${e.message}). Dostupná je jen animace „solid“. Spusťte aplikaci přes npm start nebo npm run build:manifest.`;
    console.error(msg);
    return { list: [solid], error: msg };
  }
  const names = files.filter((f) => typeof f === 'string' && FILE_RE.test(f) && f !== 'index.js');
  const results = await Promise.allSettled(names.map((f) => import(`./${f}`)));
  const seen = new Set();
  const out = [];
  results.forEach((r, i) => {
    const file = names[i];
    if (r.status === 'rejected') {
      console.error(`Animace ${file} se nepodařilo načíst a byla vynechána: ${r.reason?.message ?? r.reason}.`);
      return;
    }
    const anim = r.value.default;
    const err = validate(anim, seen);
    if (err) {
      console.error(`Animace ${file} byla vynechána: ${err}.`);
      return;
    }
    if (anim.id !== file.slice(0, -3)) {
      console.error(`Animace ${file} byla vynechána: id „${anim.id}“ neodpovídá názvu souboru.`);
      return;
    }
    seen.add(anim.id);
    out.push(anim);
  });
  // Pořadí: solid první (výchozí a záložní), ostatní podle názvu.
  out.sort((a, b) => (a.id === 'solid' ? -1 : b.id === 'solid' ? 1 : a.name.localeCompare(b.name, 'cs')));
  if (!out.some((a) => a.id === 'solid')) out.unshift(solid);
  return { list: out, error: null };
}

const { list, error } = await loadAll();

export const ANIMATIONS = list;
export const ANIMATIONS_ERROR = error;

export function getAnimation(id) {
  return ANIMATIONS.find((a) => a.id === id) ?? ANIMATIONS[0];
}
