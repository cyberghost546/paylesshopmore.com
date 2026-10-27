// Copies the label reader's files (Tesseract.js) into public/ocr/.
//
//     node scripts/copy-ocr.js
//
// Runs by itself before `npm run dev` and `npm run build` (predev/prebuild in
// package.json), so nobody has to remember it.
//
// Why copy at all: Tesseract.js normally downloads its worker, its engine and
// the language data from a CDN. This site's Content-Security-Policy
// (index.html) only lets scripts and data come from the site itself, so the
// files are served from /ocr/ instead - see src/ocr/readLabel.js, which points
// Tesseract there. They come from node_modules, so the versions are the ones
// in package-lock.json and nothing large is committed (public/ocr/ is in
// .gitignore).

import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', 'public', 'ocr');
const require = createRequire(import.meta.url);

// Where an installed package lives, from its package.json.
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

const tesseract = packageDir('tesseract.js');
const core = packageDir('tesseract.js-core');

const FILES = [
  // The Web Worker that runs the recognition off the main thread.
  [join(tesseract, 'dist', 'worker.min.js'), 'worker.min.js'],
  // The engine. Tesseract picks one of these three by what the browser can
  // do (relaxed SIMD, SIMD, or neither); "lstm" because we only use the
  // LSTM (neural network) mode, which is also the most accurate.
  [join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  // Language data: Dutch and English. "best_int" is the LSTM-only model,
  // about 3 MB each instead of 10 for the full one - Tesseract's own default.
  [join(packageDir('@tesseract.js-data/nld'), '4.0.0_best_int', 'nld.traineddata.gz'), 'nld.traineddata.gz'],
  [join(packageDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

mkdirSync(TARGET, { recursive: true });
for (const [from, name] of FILES) copyFileSync(from, join(TARGET, name));
console.log(`copy-ocr: ${FILES.length} files in public/ocr/`);
