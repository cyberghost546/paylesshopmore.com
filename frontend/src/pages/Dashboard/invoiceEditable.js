// src/pages/Dashboard/invoiceEditable.js
//
// Whether an invoice can be opened in the invoice editor: one written there,
// or one raised automatically when its shipment was paid that has no document
// yet - the editor fills it in from the shipment and the warehouse's
// measurements and keeps its number (staff/invoice_editor.py adoptable).
// Not once it has been approved or sent. The server checks the same.

const EDITABLE = ['draft', 'pending_review', 'rejected'];

export function canOpenInEditor(invoice) {
  if (!invoice || !EDITABLE.includes(invoice.status)) return false;
  return Boolean(invoice.composed || !invoice.pdf_url);
}
