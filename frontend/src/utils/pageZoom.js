// src/utils/pageZoom.js
//
// The site can be shown zoomed on larger screens (`zoom` on <html>, set
// in src/index.css as --page-zoom; 1 = normal size). The browser then reports positions -
// getBoundingClientRect, innerWidth, a pointer's clientX - in zoomed screen
// pixels, while everything the page lays out (top, left, width in CSS) is in
// unzoomed pixels. Code that measures the screen and then places something
// on it has to convert between the two, with these.

/** The page's zoom (--page-zoom on a large screen), 1 on a phone or when unset. */
export function pageZoom() {
  if (typeof window === 'undefined') return 1;
  const zoom = parseFloat(window.getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** A measured screen position or size, in the page's own (CSS) pixels. */
export function toPagePixels(value) {
  return value / pageZoom();
}

/** The visible width and height, in the page's own (CSS) pixels. */
export function viewportSize() {
  const zoom = pageZoom();
  return { width: window.innerWidth / zoom, height: window.innerHeight / zoom };
}
