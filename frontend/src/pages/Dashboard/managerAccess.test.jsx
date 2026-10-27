// A warehouse manager in the office dashboard: the floor's pages, and every
// other dashboard address sends them to the Workers page.

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RequireStaff from '../../components/RequireStaff/RequireStaff';
import { canManageWarehouse, isManagerOnly, mayOpen } from './managerAccess';

const auth = { isAuthenticated: true, isChecking: false, user: null };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const MANAGER = { role: 'manager', isWarehouseManager: true, isWarehouse: true, isStaff: false };
const OFFICE = { role: 'office', isStaff: true, isWarehouse: true };

function Where() {
  return <p>at {useLocation().pathname}</p>;
}

function openAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dashboard/*" element={<RequireStaff><Where /></RequireStaff>} />
        <Route path="/warehouse" element={<p>warehouse</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('managerAccess', () => {
  it('tells the manager apart from the office', () => {
    expect(isManagerOnly(MANAGER)).toBe(true);
    expect(isManagerOnly(OFFICE)).toBe(false);
    expect(canManageWarehouse(MANAGER)).toBe(true);
    expect(canManageWarehouse({ role: 'admin', isAdmin: true })).toBe(true);
    expect(canManageWarehouse(OFFICE)).toBe(false);
    expect(canManageWarehouse({ role: 'warehouse', isWarehouse: true })).toBe(false);
  });

  it('opens the floor pages to a manager and nothing of the office', () => {
    for (const page of ['/dashboard/workers', '/dashboard/floor-devices', '/dashboard/warehouse-access']) {
      expect(mayOpen(MANAGER, page)).toBe(true);
    }
    for (const page of ['/dashboard', '/dashboard/invoices', '/dashboard/customers', '/dashboard/quotes']) {
      expect(mayOpen(MANAGER, page)).toBe(false);
    }
    expect(mayOpen(OFFICE, '/dashboard/invoices')).toBe(true);
  });
});

describe('RequireStaff for a warehouse manager', () => {
  beforeEach(() => {
    auth.user = MANAGER;
  });

  it('lets them into a floor page', () => {
    openAt('/dashboard/floor-devices');
    expect(screen.getByText('at /dashboard/floor-devices')).toBeInTheDocument();
  });

  it('sends an office page to the Workers page instead', () => {
    openAt('/dashboard/invoices');
    expect(screen.getByText('at /dashboard/workers')).toBeInTheDocument();
  });

  it('sends the bare dashboard (the office overview) to the Workers page too', () => {
    openAt('/dashboard');
    expect(screen.getByText('at /dashboard/workers')).toBeInTheDocument();
  });

  it('still sends a warehouse worker to the warehouse', () => {
    auth.user = { role: 'warehouse', isWarehouse: true, isStaff: false };
    openAt('/dashboard/workers');
    expect(screen.getByText('warehouse')).toBeInTheDocument();
  });
});
