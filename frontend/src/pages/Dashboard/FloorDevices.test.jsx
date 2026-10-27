// Dashboard -> Floor devices: registering the device you are holding,
// revoking one, and the record of who signed in where. Admins only.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFloorLocation,
  grantFloorDeviceLocation,
  listFloorDevices,
  listFloorEvents,
  listFloorLocations,
  registerThisFloorDevice,
  revokeFloorDevice,
  revokeFloorDeviceLocation,
} from '../../api/staff';
import { getWarehouseAccess } from '../../api/warehouse';
import { renderWithProviders } from '../../test/utils';
import FloorDevices from './FloorDevices';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  listFloorDevices: vi.fn(),
  listFloorEvents: vi.fn(),
  listFloorLocations: vi.fn(),
  createFloorLocation: vi.fn(),
  grantFloorDeviceLocation: vi.fn(),
  revokeFloorDeviceLocation: vi.fn(),
  registerThisFloorDevice: vi.fn(),
  revokeFloorDevice: vi.fn(),
}));

vi.mock('../../api/warehouse', async (importOriginal) => ({
  ...(await importOriginal()),
  getWarehouseAccess: vi.fn(),
}));

const SECTION_CHOICES = [
  { key: 'measurements', title: 'Measuring', description: 'Measure and weigh packages.' },
  { key: 'packaging', title: 'Packaging', description: 'Record packaging.' },
  { key: 'damage', title: 'Damage reports', description: 'Report damage with photos.' },
];
const PACKING = { id: 7, name: 'Packing area', description: '', sections: ['measurements', 'packaging'], device_count: 0 };

const auth = { user: { id: 1, role: 'admin', isAdmin: true } };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const SCANNER = {
  id: 3,
  name: 'Scanner 1',
  created_at: '2026-10-01T08:00:00Z',
  created_by: 'Bea Baas',
  last_seen_at: '2026-10-06T09:00:00Z',
  revoked_at: null,
  revoked_by: null,
  is_this_device: false,
};

beforeEach(() => {
  auth.user = { id: 1, role: 'admin', isAdmin: true };
  listFloorDevices.mockReset().mockResolvedValue([SCANNER]);
  listFloorEvents.mockReset().mockResolvedValue([
    {
      id: 1,
      kind: 'pin_sign_in',
      kind_display: 'Signed in with PIN',
      user: 'Wim Tromp',
      device: 'Scanner 1',
      actor: null,
      created_at: '2026-10-06T09:00:00Z',
    },
  ]);
  registerThisFloorDevice.mockReset();
  revokeFloorDevice.mockReset().mockResolvedValue({ ...SCANNER, revoked_at: '2026-10-06T10:00:00Z' });
  listFloorLocations.mockReset().mockResolvedValue([]);
  createFloorLocation.mockReset();
  grantFloorDeviceLocation.mockReset();
  revokeFloorDeviceLocation.mockReset();
  getWarehouseAccess.mockReset().mockResolvedValue({ choices: SECTION_CHOICES });
});

describe('Floor devices -> locations', () => {
  it('says every device can do everything while there are no locations', async () => {
    renderWithProviders(<FloorDevices />);

    expect(await screen.findByText(/No locations yet/)).toBeInTheDocument();
    expect(screen.getByText('All work (no locations yet)')).toBeInTheDocument();
  });

  it('adds a location with the work done there', async () => {
    const user = userEvent.setup();
    createFloorLocation.mockResolvedValue(PACKING);
    renderWithProviders(<FloorDevices />);

    await user.click(await screen.findByRole('button', { name: 'Add location' }));
    await user.type(screen.getByLabelText(/Name \(e\.g\. “Packing area”\)/), 'Packing area');
    await user.click(screen.getByRole('checkbox', { name: /Measuring/ }));
    await user.click(screen.getByRole('checkbox', { name: /Packaging/ }));
    await user.click(screen.getByRole('button', { name: 'Save location' }));

    expect(createFloorLocation).toHaveBeenCalledWith({
      name: 'Packing area',
      description: '',
      sections: ['measurements', 'packaging'],
    });
  });

  it('grants a location to a device, and warns about devices without one', async () => {
    const user = userEvent.setup();
    listFloorLocations.mockResolvedValue([PACKING]);
    grantFloorDeviceLocation.mockResolvedValue({ ...SCANNER, locations: [{ id: 7, name: 'Packing area' }] });
    renderWithProviders(<FloorDevices />);

    // Deny by default: the device has no location yet, so the page says so.
    expect(await screen.findByText(/has no location yet/)).toBeInTheDocument();
    expect(screen.getByText('Measuring, Packaging')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Grant Packing area for Scanner 1' }));

    expect(grantFloorDeviceLocation).toHaveBeenCalledWith(3, 7);
    expect(await screen.findByText('“Scanner 1” can now be used in Packing area.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke Packing area for Scanner 1' })).toBeInTheDocument();
    expect(screen.queryByText(/has no location yet/)).not.toBeInTheDocument();
  });

  it('asks before revoking a location, and does nothing if cancelled', async () => {
    const user = userEvent.setup();
    listFloorLocations.mockResolvedValue([PACKING]);
    listFloorDevices.mockResolvedValue([{ ...SCANNER, locations: [{ id: 7, name: 'Packing area' }] }]);
    revokeFloorDeviceLocation.mockResolvedValue({ ...SCANNER, locations: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<FloorDevices />);

    const button = await screen.findByRole('button', { name: 'Revoke Packing area for Scanner 1' });
    await user.click(button);
    expect(revokeFloorDeviceLocation).not.toHaveBeenCalled();

    await user.click(button);
    expect(revokeFloorDeviceLocation).toHaveBeenCalledWith(3, 7);
    expect(await screen.findByText('“Scanner 1” can no longer be used in Packing area.')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('shows the location on grant and revoke events', async () => {
    listFloorEvents.mockResolvedValue([
      {
        id: 9,
        kind: 'access_granted',
        kind_display: 'Location access granted',
        user: null,
        device: 'Scanner 1',
        actor: 'Bea Baas',
        location: 'Packing area',
        created_at: '2026-10-06T09:00:00Z',
      },
    ]);
    renderWithProviders(<FloorDevices />);

    const row = (await screen.findByText('Location access granted')).closest('tr');
    expect(within(row).getByText('Packing area')).toBeInTheDocument();
    expect(within(row).getByText('by Bea Baas')).toBeInTheDocument();
  });
});

describe('Floor devices', () => {
  it('lists the devices and who signed in on them', async () => {
    renderWithProviders(<FloorDevices />);

    expect(await screen.findAllByText('Scanner 1')).toHaveLength(2);
    expect(screen.getByText('Signed in with PIN')).toBeInTheDocument();
    expect(screen.getByText('Wim Tromp')).toBeInTheDocument();
  });

  it('registers the device the admin is holding, by name', async () => {
    const user = userEvent.setup();
    registerThisFloorDevice.mockResolvedValue({ ...SCANNER, id: 4, name: 'Packing phone' });
    renderWithProviders(<FloorDevices />);

    await user.type(await screen.findByLabelText(/Name/), 'Packing phone');
    await user.click(screen.getByRole('button', { name: 'Register this device' }));

    expect(registerThisFloorDevice).toHaveBeenCalledWith('Packing phone');
    expect(await screen.findByText(/This device is now “Packing phone”/)).toBeInTheDocument();
  });

  it('says so instead of offering to register a device that already is one', async () => {
    listFloorDevices.mockResolvedValue([{ ...SCANNER, is_this_device: true }]);
    renderWithProviders(<FloorDevices />);

    expect(await screen.findByText(/You are on “Scanner 1”/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register this device' })).toBeNull();
  });

  it('revokes a device after asking', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<FloorDevices />);

    await user.click(await screen.findByRole('button', { name: 'Revoke Scanner 1' }));

    expect(revokeFloorDevice).toHaveBeenCalledWith(3);
    expect(await screen.findByText('“Scanner 1” no longer works as a floor device.')).toBeInTheDocument();
  });

  it('is not for anybody but an admin', () => {
    auth.user = { id: 2, role: 'office' };
    renderWithProviders(<FloorDevices />);

    expect(screen.getByText(/Only an admin or a warehouse manager can manage floor devices/)).toBeInTheDocument();
    expect(listFloorDevices).not.toHaveBeenCalled();
  });
});
