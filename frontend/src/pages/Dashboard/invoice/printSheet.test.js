// "Factuur afdrukken" prints the sheet alone, from a frame of its own, with
// the page's styles - not the dashboard page around it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { printSheet } from './printSheet';

function sheet() {
  const element = document.createElement('div');
  element.className = 'pls-sheet';
  element.innerHTML = '<p>Factuur PLSM20260004</p>';
  return element;
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  document.head.querySelectorAll('style[data-test]').forEach((node) => node.remove());
  vi.useRealTimers();
});

describe('printSheet', () => {
  it('prints a copy of the sheet, with the page styles and an A4 page', async () => {
    const style = document.createElement('style');
    style.dataset.test = '';
    style.textContent = '.pls-sheet { width: 210mm; }';
    document.head.appendChild(style);
    const print = vi.fn();

    // Catch the frame as it is added and stand in for the browser's print().
    const appended = vi.spyOn(document.body, 'appendChild');
    printSheet(sheet(), { title: 'PLSM20260004' });
    const frame = appended.mock.results[0].value;
    frame.contentWindow.print = print;
    appended.mockRestore();

    await vi.waitFor(() => expect(print).toHaveBeenCalled());

    const doc = frame.contentDocument;
    expect(doc.title).toBe('PLSM20260004');
    expect(doc.body.querySelector('.pls-sheet').textContent).toBe('Factuur PLSM20260004');
    expect(doc.head.textContent).toContain('.pls-sheet { width: 210mm; }');
    expect(doc.head.textContent).toContain('size: A4 portrait');
  });

  it('removes the frame afterwards', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const appended = vi.spyOn(document.body, 'appendChild');
    printSheet(sheet());
    const frame = appended.mock.results[0].value;
    frame.contentWindow.print = vi.fn();
    appended.mockRestore();

    await vi.waitFor(() => expect(frame.contentWindow.print).toHaveBeenCalled());
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('does nothing without a sheet', () => {
    printSheet(null);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
