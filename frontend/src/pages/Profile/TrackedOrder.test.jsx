// The whole order under the profile's Track & Trace box: the booking, the
// full shipment, and each webshop order with its courier - or, for a
// courier's number, which order it is.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listPackages } from '../../api/profile';
import { trackShipment } from '../../api/tracking';
import TrackingPanel from '../../components/TrackingPanel/TrackingPanel';
import { renderWithProviders } from '../../test/utils';
import TrackedOrder from './TrackedOrder';

vi.mock('../../api/profile', async (importOriginal) => ({
  ...(await importOriginal()),
  listPackages: vi.fn(),
}));
vi.mock('../../api/tracking', async (importOriginal) => ({
  ...(await importOriginal()),
  trackShipment: vi.fn(),
}));

const COURIER = {
  id: 1,
  tracking_number: '3SABC1234567',
  carrier: { code: 'postnl', name: 'PostNL', trackable: true },
  shop_name: 'bol.com',
  order_description: 'Laptop',
  package_tracking_number: 'PLSM-1001',
  status: 'in_transit',
  status_display: 'In transit',
  last_location: 'Utrecht',
  estimated_delivery: null,
  delivered_at: null,
  last_synced_at: null,
  automatic: true,
  timeline: [],
  timeline_index: 0,
  problem: null,
  events: [],
};

const SHIPMENT_RESULT = {
  kind: 'shipment',
  tracking_number: 'PLSM-1001',
  status: 'in_transit',
  status_display: 'In transit',
  booking: { shipping_number: 'PLSM-00007', created_at: '2026-10-01T10:00:00Z' },
  orders: [
    { id: 9, shop_name: 'bol.com', description: 'Laptop', screenshot: null, documents: [], carrier_tracking: COURIER },
  ],
};

const PACKAGE = {
  id: 4,
  tracking_number: 'PLSM-1001',
  status: 'in_transit',
  destination: 'Curaçao',
  created_at: '2026-10-01T10:00:00Z',
  shipped_at: '2026-10-05T10:00:00Z',
  delivered_at: null,
  weight_kg: '21.0',
  stages: [],
  stage_index: 0,
  progress: 50,
  locked: true,
  photos: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('plsm.language', 'en');
  listPackages.mockResolvedValue([PACKAGE]);
});

describe('TrackedOrder', () => {
  it('shows the booking, the full shipment and every order with its courier', async () => {
    renderWithProviders(<TrackedOrder result={SHIPMENT_RESULT} />);

    expect(screen.getByText(/Booking PLSM-00007/)).toBeInTheDocument();
    // From the full shipment ("My shipments"): the weight.
    expect(await screen.findByText('21 kg')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your orders in this shipment' })).toBeInTheDocument();
    expect(screen.getByText('PostNL')).toBeInTheDocument();
  });

  it("says which order a courier's number belongs to", () => {
    renderWithProviders(<TrackedOrder result={{ ...COURIER, kind: 'courier' }} />);

    expect(screen.getByText('Order: bol.com – Laptop')).toBeInTheDocument();
    expect(screen.getByText('Part of our shipment PLSM-1001.')).toBeInTheDocument();
  });

  it('opens from the Track & Trace box', async () => {
    const user = userEvent.setup();
    trackShipment.mockResolvedValue(SHIPMENT_RESULT);
    renderWithProviders(
      <TrackingPanel variant="inline" renderDetails={(result) => <TrackedOrder result={result} />} />,
    );

    await user.type(screen.getByRole('textbox'), 'PLSM-1001');
    await user.click(screen.getByRole('button', { name: 'Track shipment' }));

    expect(await screen.findByText(/Booking PLSM-00007/)).toBeInTheDocument();
  });
});

describe('an unknown courier number in the Track & Trace box', () => {
  it('offers to register it, with the number filled in', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../../api/client');
    trackShipment.mockRejectedValue(new ApiError('NOT_FOUND'));
    renderWithProviders(
      <TrackingPanel variant="inline" renderDetails={(result) => <TrackedOrder result={result} />} />,
    );

    await user.type(screen.getByRole('textbox'), ' 3SABC1234567 ');
    await user.click(screen.getByRole('button', { name: 'Track shipment' }));

    const link = await screen.findByRole('link', { name: /Register the package here/ });
    expect(link).toHaveAttribute('href', '/prealert?number=3SABC1234567');
  });
});
