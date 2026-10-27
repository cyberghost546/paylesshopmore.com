// src/api/invoiceEditor.js
//
// Every request the invoice editor and the invoice settings page make.
// The server side of each one is in backend/staff/invoice_editor.py and
// backend/staff/invoice_config.py; the comments there explain the rules.
//
// All of them go through request() from ./client, which adds the session
// cookie and the CSRF token and turns error responses into an ApiError with
// `.status` and `.fields` (the server's per-field messages).

import { request } from './client';

// ---- configuration ----------------------------------------------------------

/**
 * Everything the editor needs to start: settings (VAT, insurance, numbering,
 * wording), ports, charge types, company details and what this user may do.
 */
export function getInvoiceConfig() {
  return request('/staff/invoice-settings/');
}

/** Change the settings. Admins only - the server refuses anyone else (403). */
export function saveInvoiceSettings(changes) {
  return request('/staff/invoice-settings/', { method: 'PUT', body: changes });
}

/** Add (no id) or change (with id) a port or a charge type. Admins only. */
export function savePort(port) {
  return port.id
    ? request(`/staff/invoice-ports/${port.id}/`, { method: 'PUT', body: port })
    : request('/staff/invoice-ports/', { method: 'POST', body: port });
}

export function deletePort(id) {
  return request(`/staff/invoice-ports/${id}/`, { method: 'DELETE' });
}

export function saveChargeType(chargeType) {
  return chargeType.id
    ? request(`/staff/invoice-charge-types/${chargeType.id}/`, { method: 'PUT', body: chargeType })
    : request('/staff/invoice-charge-types/', { method: 'POST', body: chargeType });
}

export function deleteChargeType(id) {
  return request(`/staff/invoice-charge-types/${id}/`, { method: 'DELETE' });
}

// ---- one invoice ----------------------------------------------------------------

/** What the form says for a shipment before anybody types. */
export function getShipmentDefaults(packageId) {
  return request(`/staff/invoices/compose-defaults/?package=${encodeURIComponent(packageId)}`);
}

/** A saved invoice, in the shape the form uses (does NOT take a new number). */
export function getInvoiceForEditing(id) {
  return request(`/staff/invoices/${id}/edit/`);
}

/** "Bereken factuur": the server's own totals for the form, nothing saved. */
export function calculateInvoice(body) {
  return request('/staff/invoices/calculate/', { method: 'POST', body });
}

/**
 * The PDF the form would produce, drawn by the server, nothing saved.
 * Answers { number, totals, pdf } with `pdf` as base64. Pass `invoiceId` for
 * an invoice that already exists, so the PDF carries its own number.
 */
export function previewInvoicePdf(body, invoiceId) {
  const suffix = invoiceId ? `?invoice=${invoiceId}` : '';
  return request(`/staff/invoices/preview/${suffix}`, { method: 'POST', body });
}

/** Save a new invoice. It gets the next invoice number. 409 = already has one. */
export function createInvoice(body) {
  return request('/staff/invoices/compose/', { method: 'POST', body });
}

/** Save changes to an existing invoice. It keeps its number. */
export function updateInvoice(id, body) {
  return request(`/staff/invoices/${id}/edit/`, { method: 'PUT', body });
}

/** Delete an unsent invoice. Admins only. */
export function deleteInvoice(id) {
  return request(`/staff/invoices/${id}/`, { method: 'DELETE' });
}

/** Who created and changed this invoice, newest first. */
export function getInvoiceHistory(id) {
  return request(`/staff/invoices/${id}/history/`);
}

// ---- helpers ----------------------------------------------------------------------

/** base64 text from the server -> a PDF Blob the browser can show or save. */
export function pdfBlobFromBase64(base64) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'application/pdf' });
}
