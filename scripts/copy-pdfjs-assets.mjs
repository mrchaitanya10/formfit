// Copies the PDF.js worker and its data files (character maps, standard fonts,
// image decoders, colour profiles) into public/pdfjs so they are served from
// this site instead of a CDN. Runs automatically before dev, build and after install.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(root, 'public', 'pdfjs');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(join(source, 'build', 'pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(source, dir))) {
    cpSync(join(source, dir), join(target, dir), { recursive: true, dereference: true });
  }
}
console.log('Copied PDF.js assets to public/pdfjs');
