// src/pages/Dashboard/invoice/printSheet.js
//
// Prints the invoice sheet and nothing else.
//
// Printing the dashboard page itself with the rest hidden (the old way) was
// unreliable: the sheet sits inside a scaled, scrolled preview column of an
// app that fills the window, so browsers printed an empty page, only the part
// that was on screen, or a sheet shrunk by the preview's zoom. Here the sheet
// is copied into an invisible frame of its own, with the page's stylesheets,
// at its real A4 size, and that frame is printed. What comes out is exactly
// the preview, on one A4 page.

/** Waits for the copied <link> stylesheets and the fonts, so nothing prints unstyled. */
function whenStyled(doc) {
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')];
  const loaded = links.map(
    (link) =>
      new Promise((resolve) => {
        if (link.sheet) resolve();
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
        // Never wait for ever on a stylesheet that does not answer.
        setTimeout(resolve, 3000);
      }),
  );
  return Promise.all(loaded).then(() => doc.fonts?.ready);
}

/**
 * @param {HTMLElement} sheet  the rendered invoice (InvoiceTemplate's root)
 * @param {{ title?: string }} options  the document title, which browsers
 *   offer as the file name when "printing" to PDF
 */
export function printSheet(sheet, { title } = {}) {
  if (!sheet) return;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Out of sight but laid out: a frame that is display:none does not print.
  Object.assign(frame.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();

  // Relative addresses (the logo) resolve as on the page itself.
  const base = doc.createElement('base');
  base.href = document.baseURI;
  doc.head.appendChild(base);
  doc.title = title || document.title;

  // The page's own styles - in development Vite's <style> tags, in the built
  // app <link>s - so the sheet looks the same as in the preview.
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    doc.head.appendChild(doc.importNode(node, true));
  });
  const page = doc.createElement('style');
  page.textContent = [
    '@page { size: A4 portrait; margin: 0; }',
    'html, body { margin: 0; padding: 0; background: #ffffff; }',
    '.pls-sheet { box-shadow: none !important; transform: none !important; margin: 0 !important; }',
  ].join('\n');
  doc.head.appendChild(page);

  doc.body.appendChild(doc.importNode(sheet, true));

  whenStyled(doc).then(() => {
    const win = frame.contentWindow;
    win.focus();
    win.print();
    // print() waits for the dialog in most browsers; the delay covers those
    // where it does not.
    setTimeout(() => frame.remove(), 1000);
  });
}
