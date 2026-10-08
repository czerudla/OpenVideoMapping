// Zapíše js/animations/manifest.json pro statický hosting (Vercel).
// Spuštění: npm run build:manifest
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ANIMATIONS_DIR, MANIFEST_NAME, buildManifest } from './animations-manifest.js';

const files = await buildManifest();
await writeFile(path.join(ANIMATIONS_DIR, MANIFEST_NAME), `${JSON.stringify(files, null, 2)}\n`);
console.log(`Manifest animací zapsán (${files.length} souborů).`);
