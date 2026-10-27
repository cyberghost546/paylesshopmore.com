// The guard in front of /warehouse: a warehouse worker signed in with only a
// password is sent to the profile page to show their e-mail and PIN first.

import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import RequireWarehouse from './RequireWarehouse';

const auth = { isAuthenticated: true, isChecking: false, user: null };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

function Profile() {
  const { state } = useLocation();
  return <p>{`Profile ${state?.openWarehouse ? 'with the form open' : ''} from ${state?.from}`}</p>;
}

function renderAt(route) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/warehouse/*"
        element={
          <RequireWarehouse>
            <p>Warehouse</p>
          </RequireWarehouse>
        }
      />
      <Route path="/profile" element={<Profile />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  auth.user = null;
});

describe('RequireWarehouse', () => {
  it('sends a worker signed in with only a password to the profile page', () => {
    auth.user = { isWarehouse: true, isStaff: false, warehouseUnlocked: false };
    renderAt('/warehouse/scan');

    expect(
      screen.getByText('Profile with the form open from /warehouse/scan'),
    ).toBeInTheDocument();
  });

  it('lets a worker in once their e-mail and PIN opened it', () => {
    auth.user = { isWarehouse: true, isStaff: false, warehouseUnlocked: true };
    renderAt('/warehouse');

    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });

  it('does not ask the office', () => {
    auth.user = { isWarehouse: false, isStaff: true, warehouseUnlocked: false };
    renderAt('/warehouse');

    expect(screen.getByText('Warehouse')).toBeInTheDocument();
  });
});
