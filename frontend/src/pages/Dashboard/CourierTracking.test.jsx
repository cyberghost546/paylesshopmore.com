// The Courier tracking page: list, open a shipment, add a line, correct one -
// and the warehouse manager is not offered the office-only controls.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCarrierEvent,
  correctCarrierNumber,
  createCarrierShipment,
  getCarrierShipment,
  listCarrierShipments,
  lookupTrackingCustomers,
  voidCarrierEvent,
} from '../../api/staff';
import { renderWithProviders } from '../../test/utils';
import CourierTrackingPage from './CourierTracking';

vi.mock('../../api/staff', () => ({
  listCarrierShipments: vi.fn(),
  getCarrierShipment: vi.fn(),
  addCarrierEvent: vi.fn(),
  voidCarrierEvent: vi.fn(),
  updateCarrierShipment: vi.fn(),
  refreshCarrierShipment: vi.fn(),
  createCarrierShipment: vi.fn(),
  lookupTrackingCustomers: vi.fn(),
  correctCarrierNumber: vi.fn(),
}));
vi.mock('../../api/tracking', () => ({
  getCarriers: vi.fn().mockResolvedValue([{ code: 'postnl', name: 'PostNL', trackable: true }]),
}));

const auth = { user: { role: 'office', isStaff: true } };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const ROW = {
  id: 7,
  stage: 'incoming',
  entered_by_customer: true,
  number_changes: [],
  tracking_number: '3SABC1234567',
  carrier: { code: 'postnl', name: 'PostNL', trackable: true },
  customer_name: 'Klaas Klant',
  customer_email: 'klant@example.com',
  shop_name: 'bol.com',
  order_description: 'Laptop',
  package_tracking_number: null,
  status: 'in_transit',
  status_display: 'In transit',
  last_location: 'Utrecht',
  estimated_delivery: null,
  delivered_at: null,
  last_synced_at: null,
  next_sync_at: null,
  last_sync_error: '',
  automatic: false,
  timeline: [{ value: 'order_registered', label: 'Order registered' }],
  timeline_index: 0,
  problem: null,
  events: [
    {
      id: 3,
      status: 'in_transit',
      status_display: 'In transit',
      description: 'Typed by hand',
      location: 'Utrecht',
      occurred_at: '2026-10-19T12:00:00Z',
      verified: false,
      source: 'staff',
      source_display: 'Our staff',
      created_by_name: 'Kantoor',
      voided_at: null,
      voided_by_name: null,
      void_reason: '',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('plsm.language', 'en');
  auth.user = { role: 'office', isStaff: true };
  listCarrierShipments.mockResolvedValue({ results: [ROW], count: 1 });
  getCarrierShipment.mockResolvedValue(ROW);
});

async function openShipment(user) {
  renderWithProviders(<CourierTrackingPage />);
  await user.click(await screen.findByRole('button', { name: '3SABC1234567' }));
  await screen.findByText('What the customer sees');
}

describe('Courier tracking page', () => {
  it('lists shipments and opens one', async () => {
    const user = userEvent.setup();
    await openShipment(user);
    expect(screen.getAllByText('Klaas Klant').length).toBeGreaterThan(0);
  });

  it('adds a line typed by staff', async () => {
    const user = userEvent.setup();
    addCarrierEvent.mockResolvedValue(ROW);
    await openShipment(user);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status of the update' }), 'delayed');
    await user.type(screen.getByLabelText('Description'), 'Storm');
    await user.click(screen.getByRole('button', { name: 'Add update' }));

    expect(addCarrierEvent).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'delayed', description: 'Storm' }));
  });

  it('asks how delivery was confirmed before "Delivered"', async () => {
    const user = userEvent.setup();
    await openShipment(user);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status of the update' }), 'delivered');
    expect(screen.getByLabelText('How was delivery confirmed?')).toBeRequired();
  });

  it('corrects a line with a reason', async () => {
    const user = userEvent.setup();
    voidCarrierEvent.mockResolvedValue(ROW);
    vi.spyOn(window, 'prompt').mockReturnValue('Wrong parcel');
    await openShipment(user);

    await user.click(screen.getByRole('button', { name: 'Correct' }));
    expect(voidCarrierEvent).toHaveBeenCalledWith(7, 3, 'Wrong parcel');
  });

  it('does not offer the office-only controls to the warehouse manager', async () => {
    const user = userEvent.setup();
    auth.user = { role: 'manager', isWarehouseManager: true, isStaff: false };
    await openShipment(user);

    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add update' })).toBeInTheDocument();
  });

  it('registers a number for a customer', async () => {
    const user = userEvent.setup();
    lookupTrackingCustomers.mockResolvedValue([
      {
        id: 4,
        name: 'Klaas Klant',
        email: 'klant@example.com',
        customer_code: 'PLSM-C00004',
        orders: [{ id: 9, shop_name: 'bol.com', description: 'Laptop', booking_id: 2, reference: '' }],
        prealerts: [],
        packages: [],
      },
    ]);
    createCarrierShipment.mockResolvedValue({ ...ROW, id: 8 });
    renderWithProviders(<CourierTrackingPage />);

    await user.click(await screen.findByRole('button', { name: 'Register a number' }));
    await user.type(screen.getByLabelText('Customer'), 'klaas');
    await user.click(await screen.findByRole('button', { name: /PLSM-C00004/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Order or pre-alert' }), 'order:9');
    // Wait for the courier list to load, then pick PostNL.
    await screen.findByRole('option', { name: 'PostNL' });
    const form = screen.getByRole('form', { name: 'Register a courier number' });
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Courier' }), 'postnl');
    await user.type(within(form).getByLabelText('Tracking number'), '3SXYZ7654321');
    await user.click(screen.getByRole('button', { name: 'Register number' }));

    expect(createCarrierShipment).toHaveBeenCalledWith({
      customer: 4,
      stage: 'incoming',
      order: 9,
      carrier: 'postnl',
      tracking_number: '3SXYZ7654321',
    });
  });

  it('corrects the number with a reason', async () => {
    const user = userEvent.setup();
    correctCarrierNumber.mockResolvedValue(ROW);
    await openShipment(user);

    const form = screen.getByRole('form', { name: 'Correct the number' });
    const number = within(form).getByLabelText('Tracking number');
    await user.clear(number);
    await user.type(number, '3SNEW1234567');
    await user.type(within(form).getByLabelText('Why (kept on record)'), 'Typo');
    await user.click(within(form).getByRole('button', { name: 'Correct number' }));

    expect(correctCarrierNumber).toHaveBeenCalledWith(7, {
      tracking_number: '3SNEW1234567',
      carrier: 'postnl',
      reason: 'Typo',
    });
  });

  it('does not offer registering or correcting numbers to the warehouse manager', async () => {
    const user = userEvent.setup();
    auth.user = { role: 'manager', isWarehouseManager: true, isStaff: false };
    await openShipment(user);
    expect(screen.queryByRole('button', { name: 'Register a number' })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Correct the number' })).toBeNull();
  });
});
