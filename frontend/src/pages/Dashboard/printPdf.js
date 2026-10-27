// src/pages/Dashboard/printPdf.js
//
// Prints a stored invoice PDF straight from the dashboard, without opening it
// in a new tab first.
//
// How: the PDF is fetched (with the session cookie, like every dashboard
// request), turned into a blob: URL, loaded into an invisible frame, and that
// frame is printed. A blob: URL counts as our own page, so the browser lets
// us call print() on it. If anything goes wrong (an old browser, a blocked
// frame) the PDF opens in a new tab instead, where Ctrl+P still works.

/** Turns the invoice's pdf_url into its "save as a file" form. */
export function downloadUrl(pdfUrl) {
  return `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}download=1`;
}

/**
 * @param {string} url  the invoice's pdf_url
 * @returns {Promise<void>} rejects when the PDF could not be fetched
 */
export async function printPdf(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`PDF request failed (${response.status})`);
  const blobUrl = URL.createObjectURL(await response.blob());

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

  frame.addEventListener('load', () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(blobUrl, '_blank', 'noopener');
    }
    // Long enough for the print dialog to have taken its copy.
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  });

  frame.src = blobUrl;
  document.body.appendChild(frame);
}
