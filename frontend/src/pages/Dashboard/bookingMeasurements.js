// src/pages/Dashboard/bookingMeasurements.js
//
// Small helpers for showing the warehouse's measurements on a booking
// (BookingWarehouseMeasurements.jsx, and the "Measured" field in
// Bookings.jsx). Kept out of the component file so they can be imported
// and tested on their own.

/** "60.0" -> "60", "0.1920" -> "0,192": Dutch decimals, no trailing zeros. */
export function number(value) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString('nl-NL', { maximumFractionDigits: 3 });
}

/** "120 × 80 × 100 cm", or a dash for a side not measured yet. */
export function sizes(row) {
  return `${number(row.length_cm)} × ${number(row.width_cm)} × ${number(row.height_cm)} cm`;
}

/**
 * The warehouse's best figures for this booking in one line, or null:
 * the newest scanner measurement if there is one, else the newest intake
 * sheet's totals. Used by the "Measured" field higher up on the booking.
 */
export function warehouseSummary(warehouse) {
  const scanned = warehouse?.package?.find((row) => row.current);
  if (scanned) return `${number(scanned.volume_m3)} m³ · ${number(scanned.weight_kg)} kg`;

  const sheet = warehouse?.intake_sheets?.find((s) => s.totals.volume_m3 || s.totals.weight_kg);
  if (sheet) {
    return [sheet.totals.volume_m3 && `${number(sheet.totals.volume_m3)} m³`, sheet.totals.weight_kg && `${number(sheet.totals.weight_kg)} kg`]
      .filter(Boolean)
      .join(' · ');
  }
  return null;
}
