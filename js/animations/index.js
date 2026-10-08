// Registr animací. Pořadí importů a pole REGISTRY určuje pořadí v nabídce editoru.
// Nová animace = nový soubor <id>.js v této složce + jeden import a jeden řádek v poli.
import solid from './solid.js';
import pulse from './pulse.js';
import rainbow from './rainbow.js';
import stripes from './stripes.js';
import scan from './scan.js';
import level from './level.js';
import rings from './rings.js';
import plasma from './plasma.js';
import fire from './fire.js';
import sparkle from './sparkle.js';
import strobe from './strobe.js';
import balls from './balls.js';
import matrix from './matrix.js';
import bounce from './bounce.js';
import torch from './torch.js';
import pacman from './pacman.js';
import pong from './pong.js';

const REGISTRY = [
  solid,
  pulse,
  rainbow,
  stripes,
  scan,
  level,
  rings,
  plasma,
  fire,
  sparkle,
  strobe,
  balls,
  matrix,
  bounce,
  torch,
  pacman,
  pong,
];

const REQUIRED = ['id', 'name', 'colors', 'glsl'];

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
  if (![0, 1, 2].includes(a.colors)) return 'pole „colors“ musí být 0, 1 nebo 2';
  if (seen.has(a.id)) return `duplicitní id „${a.id}“`;
  return null;
}

function buildAnimations(list) {
  const seen = new Set();
  const out = [];
  list.forEach((a, i) => {
    const err = validate(a, seen);
    if (err) {
      console.error(`Animace č. ${i + 1} (${a?.id ?? '?'}) byla vynechána: ${err}.`);
      return;
    }
    seen.add(a.id);
    out.push(a);
  });
  return out;
}

export const ANIMATIONS = buildAnimations(REGISTRY);

export function getAnimation(id) {
  return ANIMATIONS.find((a) => a.id === id) ?? ANIMATIONS[0];
}
