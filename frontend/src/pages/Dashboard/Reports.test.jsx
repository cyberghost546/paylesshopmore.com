// Dashboard -> Monthly report. What matters: the chosen month's figures are
// shown with their change from the month before, the arrows move between
// months (and ask the server for that month), and the tables are filled in.
//
// jsdom reports an English browser, so these read the English texts.

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getMonthlyReport } from '../../api/staff';
import Reports from './Reports';

vi.mock('../../api/staff', () => ({ getMonthlyReport: vi.fn() }));

const FIGURES = {
  bookings: 12,
  bookings_cancelled: 1,
  quotes: 4,
  messages: 9,
  packages_received: 10,
  packages_shipped: 8,
  packages_delivered: 6,
  weight_shipped_kg: 120.5,
  average_weight_kg: 15.1,
  invoices_sent: 5,
  invoiced: '1500.00',
  new_customers: 3,
};

function report(month, previous) {
  return {
    month,
    previous_month: previous,
    is_current: false,
    current: FIGURES,
    previous: { ...FIGURES, bookings: 10, invoiced: '1000.00' },
    by_destination: [{ destination: 'CW', label: 'Curaçao', bookings: 7, weight_kg: 80 }],
    by_freight: [{ freight: 'sea', label: 'Zeevracht', bookings: 12 }],
    months: Array.from({ length: 12 }, (_, index) => ({
      month: `2025-${String(index + 1).padStart(2, '0')}`,
      bookings: index,
      packages_shipped: index,
      invoiced: '0.00',
    })),
  };
}

beforeEach(() => {
  getMonthlyReport.mockReset().mockImplementation((month) =>
    Promise.resolve(month === '2025-12' ? report('2025-12', '2025-11') : report('2026-01', '2025-12')),
  );
});

describe('the monthly report', () => {
  it('shows the figures with the change from the month before', async () => {
    renderWithProviders(<Reports />, { route: '/dashboard/reports?month=2026-01' });

    expect(getMonthlyReport).toHaveBeenCalledWith('2026-01');
    const bookings = (await screen.findAllByText('Bookings'))[0].closest('div');
    expect(within(bookings).getByText('12')).toBeInTheDocument();
    // 10 -> 12 is +20%.
    expect(within(bookings).getByText(/\+20%/)).toBeInTheDocument();
    expect(screen.getByText('1 of these bookings were cancelled.')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Curaçao' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Sea freight' })).toBeInTheDocument();
  });

  it('goes to the month before with the arrow', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Reports />, { route: '/dashboard/reports?month=2026-01' });
    await screen.findAllByText('Bookings');

    await user.click(screen.getByRole('button', { name: /Previous month/ }));

    expect(getMonthlyReport).toHaveBeenLastCalledWith('2025-12');
    expect(await screen.findByRole('heading', { name: /December 2025/ })).toBeInTheDocument();
  });
});
