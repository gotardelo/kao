import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
mkdirSync(publicDir, { recursive: true });
for (const file of ['index.html', 'manifest.json', 'sw.js']) {
  copyFileSync(resolve(root, file), resolve(publicDir, file));
}
for (const dir of ['css', 'js', 'icons']) {
  cpSync(resolve(root, dir), resolve(publicDir, dir), { recursive: true, force: true });
}
