// src/pages/Warehouse/accessContext.js
//
// What the signed-in account may use in the warehouse app, as set by an
// admin on Dashboard -> Warehouse access (backend warehouse/access.py).
// WarehouseLayout loads it once and provides it; pages ask with
// `can('damage')` and leave out what is switched off. The server refuses a
// switched-off section anyway - this only keeps the screens from offering it.
//
// Without a provider (tests, or before it has loaded) everything is allowed,
// which is how the warehouse worked before the switches existed.

import { createContext, useContext } from 'react';

export const WarehouseAccessContext = createContext(null);

const ALLOW_ALL = { can: () => true };

/** @returns {{ can: (section: string) => boolean }} */
export function useWarehouseAccess() {
  return useContext(WarehouseAccessContext) ?? ALLOW_ALL;
}
