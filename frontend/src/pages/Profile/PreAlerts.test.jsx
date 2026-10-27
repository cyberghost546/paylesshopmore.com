// The customer's pre-alerts at the top of My shipments: the list, the status
// shown (only what was recorded), the details and cancelling.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPrealert, listPrealerts } from '../../api/prealerts';
import { renderWithProviders } from '../../test/utils';
import PreAlerts from './PreAlerts';
import { prealertStatus } from './prealertStatus';

vi.mock('../../api/prealerts', () => ({
  listPrealerts: vi.fn(),
  cancelPrealert: vi.fn(),
  prealertDocumentUrl: (path) => path,
}));

const PREALERT = {
  id: 1,
  reference: 'PA-2026-000007',
  tracking_number: '3SABC1234567',
  carrier: { code: 'postnl', name: 'PostNL' },
  shop_name: 'bol.com',
  description: 'Motherboard',
  consignee_name: 'Klaas Klant',
  consignee_address_text: 'Kaya Grandi 24\nWillemstad',
  declared_value: '149.95',
  currency: 'EUR',
  status: 'submitted',
  arrived_at: null,
  package_tracking_number: null,
  documents: [{ id: 5, name: 'factuur.pdf', url: '/api/prealerts/1/documents/5/' }],
  carrier_tracking: null,
  can_cancel: true,
  created_at: '2026-10-20T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('plsm.language', 'en');
  listPrealerts.mockResolvedValue([PREALERT]);
});

describe('prealertStatus', () => {
  it('says only what was recorded', () => {
    expect(prealertStatus(PREALERT).key).toBe('prealert.status.submitted');
    expect(prealertStatus({ ...PREALERT, carrier_tracking: { status: 'in_transit' } }).key).toBe(
      'courier.status.in_transit',
    );
    expect(prealertStatus({ ...PREALERT, status: 'arrived' }).key).toBe('prealert.status.arrived');
  });
});

describe('PreAlerts', () => {
  it('lists the pre-alerts with their status', async () => {
    renderWithProviders(<PreAlerts />);
    expect(await screen.findByText('PA-2026-000007')).toBeInTheDocument();
    expect(screen.getByText('PostNL 3SABC1234567')).toBeInTheDocument();
    expect(screen.getByText('Pre-alert submitted')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pre-alert a package' })).toHaveAttribute('href', '/prealert');
  });

  it('opens the details and cancels while it is on its way', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    cancelPrealert.mockResolvedValue({ ...PREALERT, status: 'cancelled', can_cancel: false });
    renderWithProviders(<PreAlerts />);

    await user.click(await screen.findByRole('button', { name: /PA-2026-000007/ }));
    expect(screen.getByRole('link', { name: 'factuur.pdf' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel this pre-alert' }));

    expect(cancelPrealert).toHaveBeenCalledWith(1);
    expect(await screen.findByText('The pre-alert has been cancelled.')).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    listPrealerts.mockResolvedValue([]);
    renderWithProviders(<PreAlerts />);
    expect(await screen.findByText(/No pre-alerts yet/)).toBeInTheDocument();
  });
});
