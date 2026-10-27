// src/ocr/readLabel.js
//
// Reads the text on a photo of a shipping label, in the browser, with
// Tesseract.js. The photo never leaves the device.
//
// The result is a plain list of lines ("J. Jansen", "Kaya Grandi 12", ...).
// It does not guess which line is the sender or the recipient - the person
// holding the box taps the lines and says where they go (LabelReader.jsx).
//
// Tesseract's files are served by this site from /ocr/ (copied there by
// scripts/copy-ocr.js), not from its default CDN, because the site's
// Content-Security-Policy only allows its own origin.

const BASE = '/ocr/';

// One worker for the whole visit. Starting it costs a few seconds (it loads
// the engine and the Dutch and English language data, about 10 MB the first
// time; the browser keeps the language data afterwards), so it is started
// once, on the first label, and reused for every label after that.
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      // Imported only when a label is read, so the rest of the site never
      // downloads Tesseract.
      .then(({ createWorker }) =>
        createWorker(['nld', 'eng'], 1, {
          workerPath: `${BASE}worker.min.js`,
          corePath: BASE,
          langPath: BASE,
          // Load the worker from its own URL rather than a blob: URL, which
          // the Content-Security-Policy would block.
          workerBlobURL: false,
        }),
      )
      .catch((error) => {
        // Forget the failed start, so the next try starts again from scratch.
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

/**
 * The text of a recognised label, as tidy lines: spaces squeezed, empty lines
 * and one-character noise (a stray "|" from a box edge) dropped.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function toLines(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.replace(/[^\p{L}\p{N}]/gu, '').length >= 2);
}

/**
 * Reads a label.
 *
 * @param {File|Blob|HTMLCanvasElement} image  a photo of the label
 * @returns {Promise<string[]>} its lines of text, top to bottom
 */
export async function readLabel(image) {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return toLines(data.text);
}
