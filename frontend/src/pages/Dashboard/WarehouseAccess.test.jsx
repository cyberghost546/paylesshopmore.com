// Dashboard -> Warehouse access: an admin switches parts of the warehouse
// app on and off for warehouse workers; other office staff only look.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getWarehouseAccess, saveWarehouseAccess } from '../../api/warehouse';
import WarehouseAccess from './WarehouseAccess';

vi.mock('../../api/warehouse', async (importOriginal) => ({
  ...(await importOriginal()),
  getWarehouseAccess: vi.fn(),
  saveWarehouseAccess: vi.fn(),
}));

const auth = { user: { isAdmin: true } };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const CHOICES = [
  { key: 'damage', title: 'Damage reports', description: 'Report damage with photos.' },
  { key: 'photos', title: 'Package photos', description: 'Photos for the customer.' },
];

function access(sections) {
  return { sections, choices: CHOICES, mine: sections, updated_at: null };
}

beforeEach(() => {
  auth.user = { isAdmin: true };
  getWarehouseAccess.mockReset().mockResolvedValue(access({ damage: true, photos: true }));
  saveWarehouseAccess.mockReset();
});

describe('Warehouse access', () => {
  it('lets an admin switch a part off and save it', async () => {
    const user = userEvent.setup();
    saveWarehouseAccess.mockResolvedValue(access({ damage: false, photos: true }));
    renderWithProviders(<WarehouseAccess />);

    const damage = await screen.findByRole('switch', { name: /Damage reports/ });
    expect(damage).toBeChecked();
    expect(screen.getByText('Everything is on for warehouse workers.')).toBeInTheDocument();

    await user.click(damage);
    expect(screen.getByText('1 part is switched off for warehouse workers.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(saveWarehouseAccess).toHaveBeenCalledWith({ damage: false, photos: true });
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });

  it('is read-only for office staff who are not admins', async () => {
    auth.user = { isAdmin: false };
    renderWithProviders(<WarehouseAccess />);

    expect(await screen.findByRole('switch', { name: /Damage reports/ })).toBeDisabled();
    expect(screen.getByText(/Only an admin or a warehouse manager can change these/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
