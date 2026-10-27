// src/api/prealerts.js
//
// Pre-alerts: a customer telling us a parcel is on its way to our warehouse
// (backend/prealerts/). Every route needs a signed-in customer and only ever
// answers about their own pre-alerts; the office's routes are in staff.js.

import { apiUrl, request } from './client';

/** The customer's own pre-alerts, newest first. */
export async function listPrealerts() {
  const data = await request('/prealerts/');
  return data.results ?? data;
}

/**
 * Send the pre-alert form.
 *
 * @param {{ trackingNumber: string, carrier: string, shop: number|null,
 *           shopName: string, description: string, consigneeName: string,
 *           consigneeAddress: number|null, declaredValue?: string,
 *           currency?: string, restrictedConfirmed: boolean, files: File[] }} form
 * @returns {Promise<object>} the saved pre-alert, with its reference
 */
export async function createPrealert(form) {
  const formData = new FormData();
  formData.append('tracking_number', form.trackingNumber);
  formData.append('carrier', form.carrier);
  if (form.shop) formData.append('shop', String(form.shop));
  formData.append('shop_name', form.shopName ?? '');
  formData.append('description', form.description);
  formData.append('consignee_name', form.consigneeName);
  if (form.consigneeAddress) formData.append('consignee_address', String(form.consigneeAddress));
  // Optional: the form no longer asks for a value; left out, the server stores none.
  if (form.declaredValue) formData.append('declared_value', form.declaredValue);
  if (form.currency) formData.append('currency', form.currency);
  formData.append('restricted_items_confirmed', form.restrictedConfirmed ? 'true' : 'false');
  for (const file of form.files ?? []) formData.append('documents', file);
  return request('/prealerts/', { method: 'POST', formData });
}

/**
 * Read a screenshot or PDF of the order or shipping e-mail with AI
 * (backend prealerts/reading.py). Nothing is saved.
 *
 * @param {File} file
 * @returns {Promise<{ tracking_number: string, carrier: string, shop: number|null,
 *                     shop_name: string, description: string }>}
 *   "" / null for anything that was not found.
 */
export async function readPrealertScreenshot(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/prealerts/read/', { method: 'POST', formData });
}

/** Withdraw a pre-alert while the parcel is not at the warehouse yet. */
export async function cancelPrealert(id) {
  return request(`/prealerts/${id}/cancel/`, { method: 'POST' });
}

/** The full address of an invoice file's download route (sent as `url`). */
export function prealertDocumentUrl(path) {
  return apiUrl(path.replace(/^\/api/, ''));
}
