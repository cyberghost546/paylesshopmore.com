// src/pages/Dashboard/reportMath.js
//
// Small sums for the Monthly report page (Reports.jsx), in their own file so
// they can be tested on their own (reportMath.test.js).

/**
 * Moves a 'YYYY-MM' string by `count` months.
 * Example: shiftMonth('2026-01', -1) -> '2025-12'
 */
export function shiftMonth(month, count) {
  const [year, monthNumber] = month.split('-').map(Number);
  // Months counted from year 0, so going back past January just works.
  const index = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The change from the previous month, or null when there is nothing honest
 * to say (no figure). A rise from zero has no percentage, so it is worded.
 *
 * Example: change(12, 10) -> { direction: 'up', percent: 20 }
 */
export function change(current, previous) {
  const now = Number(current ?? 0);
  const before = Number(previous ?? 0);
  if (current === null || current === undefined) return null;
  if (now === before) return { direction: 'flat', percent: 0 };
  if (before === 0) return { direction: 'up', percent: null };
  return {
    direction: now > before ? 'up' : 'down',
    percent: Math.round(((now - before) / before) * 100),
  };
}
