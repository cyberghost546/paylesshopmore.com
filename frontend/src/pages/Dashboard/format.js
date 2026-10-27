// src/pages/Dashboard/format.js
//
// Date and money formatting for the dashboard. The back office is used by
// staff in one place, so these are fixed to nl-NL rather than following the
// site's language switcher — a shipment date that changes shape depending on
// which language tab someone left open is a way to misread it.

const LOCALE = 'nl-NL';

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const moneyFormat = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'EUR',
});

/** @param {string|null} value an ISO timestamp from the API */
export function formatDate(value) {
  if (!value) return '—';
  return dateFormat.format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return '—';
  return dateTimeFormat.format(new Date(value));
}

/** The API sends decimals as strings, so that they survive the trip exactly. */
export function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  return moneyFormat.format(Number(value));
}

export function formatWeight(value) {
  if (value === null || value === undefined || value === '') return '—';
  // Trailing zeros off: 2.500 reads as 2,5 kg.
  return `${Number(value).toLocaleString(LOCALE, { maximumFractionDigits: 3 })} kg`;
}

/** A file size: 126994 -> '124 KB', 5242880 -> '5.0 MB'. */
export function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
