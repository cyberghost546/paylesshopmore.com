// Which invoices open in the editor: written there, or raised automatically
// with no document yet - and only until they are approved or sent.

import { describe, expect, it } from 'vitest';
import { canOpenInEditor } from './invoiceEditable';

describe('canOpenInEditor', () => {
  it('opens an automatic invoice that has no document yet', () => {
    expect(canOpenInEditor({ status: 'pending_review', composed: false, pdf_url: null })).toBe(true);
  });

  it('opens one written in the editor', () => {
    expect(canOpenInEditor({ status: 'rejected', composed: true, pdf_url: '/x.pdf' })).toBe(true);
  });

  it('leaves an uploaded PDF alone', () => {
    expect(canOpenInEditor({ status: 'pending_review', composed: false, pdf_url: '/upload.pdf' })).toBe(false);
  });

  it('is closed once approved or sent', () => {
    for (const status of ['approved', 'sent']) {
      expect(canOpenInEditor({ status, composed: true, pdf_url: null })).toBe(false);
    }
  });
});
