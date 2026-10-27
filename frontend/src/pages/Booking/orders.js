// src/pages/Booking/orders.js
//
// The rules for "Uw bestellingen" on the booking form (OrdersField.jsx):
// one row per store the customer bought from. Kept out of the component file
// because a file exporting a component may only export components (React
// Fast Refresh).
//
// A row, while the form is being filled in:
//   key          stable id for React's list, never sent
//   shop         '' (not chosen yet), 'other', or a store id from the list
//   shopName     the store's name when 'other' was chosen
//   description  what they bought there
//   file         the screenshot (a File), or null
//
// The limits match the server (backend bookings/models.py): at most
// MAX_ORDERS rows, one screenshot per row, SCREENSHOT.maxBytes each.

export const MAX_ORDERS = 10;

export const SCREENSHOT = {
  maxBytes: 10 * 1024 * 1024,
  extensions: ['.png', '.jpg', '.jpeg', '.webp', '.pdf'],
};

let nextKey = 1;

/** An empty row. */
export function newRow() {
  nextKey += 1;
  return { key: `order-${nextKey}`, shop: '', shopName: '', description: '', file: null };
}

export function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

/**
 * Why a screenshot cannot be used, as a translation key, or null when it is
 * fine. The key's text takes {name}.
 */
export function screenshotProblem(file) {
  if (!SCREENSHOT.extensions.includes(extensionOf(file.name))) return 'booking.orders.wrongType';
  if (file.size > SCREENSHOT.maxBytes) return 'booking.orders.tooBig';
  return null;
}

/**
 * The problems with each row, as { [row.key]: { shop?, shopName?, description? } }
 * holding translation keys. Empty object when every row is fine.
 */
export function validateOrders(rows) {
  const errors = {};
  for (const row of rows) {
    const rowErrors = {};
    if (!row.shop) rowErrors.shop = 'booking.orders.errors.shop';
    if (row.shop === 'other' && !row.shopName.trim())
      rowErrors.shopName = 'booking.orders.errors.shopName';
    if (!row.description.trim()) rowErrors.description = 'booking.orders.errors.description';
    if (Object.keys(rowErrors).length) errors[row.key] = rowErrors;
  }
  return errors;
}

/** The rows as the server takes them (without the screenshots). */
export function toPayload(rows) {
  return rows.map((row) =>
    row.shop === 'other'
      ? { shop: null, shop_name: row.shopName.trim(), description: row.description.trim() }
      : { shop: Number(row.shop), description: row.description.trim() },
  );
}
