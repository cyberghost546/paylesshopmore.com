// The warehouse scanner reading a courier's barcode (PostNL, DHL ...) that a
// customer entered on their order: it says whose parcel it is, and one tap
// records the arrival - once.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmCourierArrival, scanCode } from '../../api/staff';
import { recordScan } from '../../api/warehouse';
import { renderWithProviders } from '../../test/utils';
import Scan from './Scan';

vi.mock('../../api/staff', () => ({
  scanCode: vi.fn(),
  confirmCourierArrival: vi.fn(),
  createIntakeSheet: vi.fn(),
}));
vi.mock('../../api/warehouse', () => ({ recordScan: vi.fn() }));

const COURIER = {
  carrier: 'PostNL',
  tracking_number: '3SABC1234567',
  customer: 'Klaas Klant',
  shop_name: 'bol.com',
  order_description: 'Laptop',
  booking_number: 'PLSM-00007',
  package_tracking_number: null,
  status: 'in_transit',
  status_display: 'In transit',
  arrived: false,
  arrived_at: null,
  arrived_by: null,
};

const FOUND = {
  code: '3SABC1234567',
  match: 'booking',
  shipment: null,
  sheet: null,
  package: null,
  booking: { id: 3, shipping_number: 'PLSM-00007', sender: 'Klaas', recipient: 'Maria', destination: 'Curaçao' },
  courier: COURIER,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('plsm.language', 'en');
  scanCode.mockResolvedValue(FOUND);
});

async function scan(user) {
  renderWithProviders(<Scan />);
  await user.type(screen.getByLabelText('Or type or scan the code'), '3SABC1234567');
  await user.click(screen.getByRole('button', { name: 'Look it up' }));
}

describe('scanning a courier barcode', () => {
  it("shows whose parcel it is and records the arrival", async () => {
    const user = userEvent.setup();
    confirmCourierArrival.mockResolvedValue({
      already: false,
      courier: { ...COURIER, arrived: true, arrived_at: '2026-10-20T10:00:00Z', arrived_by: 'Wim' },
    });
    await scan(user);

    expect(await screen.findByText("A customer's parcel")).toBeInTheDocument();
    expect(screen.getByText('Klaas Klant · bol.com: Laptop')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm arrival' }));

    expect(confirmCourierArrival).toHaveBeenCalledWith('3SABC1234567');
    expect(await screen.findByText('Arrival recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm arrival' })).toBeNull();
  });

  it('says when the arrival was already recorded', async () => {
    const user = userEvent.setup();
    scanCode.mockResolvedValue({
      ...FOUND,
      courier: { ...COURIER, arrived: true, arrived_at: '2026-10-20T10:00:00Z', arrived_by: 'Wim' },
    });
    await scan(user);

    expect(await screen.findByText(/Arrival was already recorded on .* by Wim\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm arrival' })).toBeNull();
  });

  it('waits for the arrival tap before opening a shipment', async () => {
    const user = userEvent.setup();
    scanCode.mockResolvedValue({ ...FOUND, match: 'package', shipment: { id: 42 }, package: { id: 42 } });
    await scan(user);

    expect(await screen.findByRole('button', { name: 'Confirm arrival' })).toBeInTheDocument();
    expect(recordScan).not.toHaveBeenCalled();
  });
});
