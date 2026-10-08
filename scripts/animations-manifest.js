// Sdílená logika manifestu animací: server, build skript i kontrolní skript.
// Manifest je seřazené pole názvů souborů z js/animations/ (bez index.js).
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ANIMATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'animations');
export const MANIFEST_NAME = 'manifest.json';

const FILE_RE = /^[a-z0-9-]+\.js$/;

export async function buildManifest(dir = ANIMATIONS_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && FILE_RE.test(e.name) && e.name !== 'index.js')
    .map((e) => e.name)
    .sort();
}
