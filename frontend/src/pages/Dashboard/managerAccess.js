// src/pages/Dashboard/managerAccess.js
//
// What a warehouse manager opens in the office dashboard: the pages that run
// the warehouse floor, and nothing of the office. The manager is not staff, so
// every other page would only get 403s from the API anyway (staff/permissions.py
// IsWarehouseManager / IsStaffOrWarehouseManager); this is so the dashboard
// does not offer them in the first place.

/** The dashboard pages a warehouse manager may open. The first is their start. */
export const MANAGER_PAGES = [
  '/dashboard/workers',
  '/dashboard/floor-devices',
  '/dashboard/warehouse-access',
  '/dashboard/measurements',
  // Read courier shipments and add updates (arrivals, handovers).
  '/dashboard/courier-tracking',
  // Read the pre-alerts: which parcels are expected.
  '/dashboard/prealerts',
];

/** Where a warehouse manager lands when they open the dashboard. */
export const MANAGER_HOME = MANAGER_PAGES[0];

/** A warehouse manager, as opposed to the office: the narrow dashboard. */
export function isManagerOnly(user) {
  return Boolean(user?.isWarehouseManager && !user?.isStaff);
}

/**
 * Whether this account may open this dashboard address. The office opens
 * everything; a manager, only MANAGER_PAGES (and the warehouse app, which is
 * outside /dashboard).
 */
export function mayOpen(user, pathname) {
  if (!isManagerOnly(user)) return true;
  return MANAGER_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/** Admins and warehouse managers: who may run the floor (workers, devices, access). */
export function canManageWarehouse(user) {
  return Boolean(user?.isAdmin || user?.canManageWarehouse || ['admin', 'manager'].includes(user?.role));
}
