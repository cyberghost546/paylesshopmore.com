// The office's Pre-alerts page: the list, the details, adding a parcel to a
// shipment - and the warehouse manager is not offered the office's controls.

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addPrealertToShipment, listStaffPrealerts } from '../../api/staff';
import { renderWithProviders } from '../../test/utils';
import PreAlertsPage from './PreAlerts';

vi.mock('../../api/staff', () => ({
  listStaffPrealerts: vi.fn(),
  addPrealertToShipment: vi.fn(),
  cancelStaffPrealert: vi.fn(),
}));
vi.mock('../../api/prealerts', () => ({ prealertDocumentUrl: (path) => path }));
const auth = { user: { role: 'office', isStaff: true } };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const ROW = {
  id: 1,
  reference: 'PA-2026-000007',
  tracking_number: '3SABC1234567',
  carrier: { code: 'postnl', name: 'PostNL' },
  shop_name: 'bol.com',
  description: 'Motherboard',
  consignee_name: 'Klaas Klant',
  consignee_address_text: 'Willemstad',
  declared_value: '149.95',
  currency: 'EUR',
  status: 'submitted',
  arrived_at: null,
  arrived_by_name: null,
  package_tracking_number: null,
  documents: [],
  carrier_tracking: null,
  customer_name: 'Klaas Klant',
  customer_email: 'klant@example.com',
  restricted_items_confirmed_at: '2026-10-20T10:00:00Z',
  created_at: '2026-10-20T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('plsm.language', 'en');
  auth.user = { role: 'office', isStaff: true };
  listStaffPrealerts.mockResolvedValue({ results: [ROW], count: 1 });
});

describe('Pre-alerts page', () => {
  it('opens one and adds it to a shipment', async () => {
    const user = userEvent.setup();
    addPrealertToShipment.mockResolvedValue({ ...ROW, status: 'in_shipment', package_tracking_number: 'PLSM-00042' });
    renderWithProviders(<PreAlertsPage />);

    await user.click(await screen.findByRole('button', { name: 'PA-2026-000007' }));
    expect(screen.getByText('The customer did not add an invoice.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Add to shipment'), 'PLSM-00042');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(addPrealertToShipment).toHaveBeenCalledWith(1, 'PLSM-00042');
    expect(await screen.findByText('Added to the shipment.')).toBeInTheDocument();
  });

  it('shows the warehouse manager the details but not the office controls', async () => {
    const user = userEvent.setup();
    auth.user = { role: 'manager', isWarehouseManager: true, isStaff: false };
    renderWithProviders(<PreAlertsPage />);

    await user.click(await screen.findByRole('button', { name: 'PA-2026-000007' }));
    expect(screen.getByText(/klant@example.com/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Add to shipment')).toBeNull();
  });
});
