// Opening a booking shows the whole booking in a pop-up over the list.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listBookings, sendBookingToWarehouse } from '../../api/staff';
import { renderWithProviders } from '../../test/utils';
import Bookings from './Bookings';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  listBookings: vi.fn(),
  sendBookingToWarehouse: vi.fn(),
  updateBooking: vi.fn(),
}));

const BOOKING = {
  id: 3,
  shipping_number: 'CI-00333',
  shipment_blocked: null,
  status: 'new',
  status_display: 'New',
  freight: 'sea',
  freight_display: 'Zeevracht',
  destination_label: 'Curaçao',
  sender_name: 'Client Client',
  sender_email: 'client@client.com',
  sender_phone: '+31 6 123456789',
  recipient_name: 'Christopher Molina',
  recipient_address: 'Chocho 23',
  recipient_city: 'Curaçao',
  recipient_phone: '06 22836446',
  quantity: null,
  unit_display: 'Dozen',
  value_eur: '344.00',
  orders: [],
  warehouse: null,
  shipment: null,
  created_at: '2026-10-07T10:00:00Z',
  updated_at: '2026-10-07T10:00:00Z',
};

beforeEach(() => {
  listBookings.mockReset().mockResolvedValue({ results: [BOOKING], count: 1, hasNext: false, hasPrevious: false });
});

describe('Bookings', () => {
  it('opens a booking in a pop-up, and closes it again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Bookings />);

    await user.click(await screen.findByRole('button', { name: 'Details' }));

    const dialog = screen.getByRole('dialog', { name: 'CI-00333' });
    expect(within(dialog).getByText('Office')).toBeInTheDocument();
    expect(within(dialog).getByText('Shipping no.')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens it by clicking anywhere on the row too', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Bookings />);

    await user.click(await screen.findByText('Christopher Molina'));

    expect(screen.getByRole('dialog', { name: 'CI-00333' })).toBeInTheDocument();
  });

  it('sends a booking with no number to the warehouse, which gives it the next PLSM number', async () => {
    const user = userEvent.setup();
    listBookings.mockResolvedValue({
      results: [{ ...BOOKING, shipping_number: '' }], count: 1, hasNext: false, hasPrevious: false,
    });
    sendBookingToWarehouse.mockResolvedValue({
      ...BOOKING,
      shipping_number: 'PLSM-00001',
      status: 'confirmed',
      shipment: { id: 9, tracking_number: 'PLSM-00001', status: 'quoted', sent_to_warehouse_at: '2026-10-15T10:00:00Z' },
    });
    renderWithProviders(<Bookings />);

    await user.click(await screen.findByRole('button', { name: 'Details' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send to warehouse' }));

    expect(sendBookingToWarehouse).toHaveBeenCalledWith(3);
    expect(await within(screen.getByRole('dialog')).findByText(/Booking PLSM-00001 has been sent to the warehouse/)).toBeInTheDocument();
  });
});
