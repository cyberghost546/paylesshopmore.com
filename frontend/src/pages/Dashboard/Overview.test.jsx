// Dashboard -> Overview: the office's landing page. A busy day and a quiet
// one, the warehouse panel, the figures with their change from the previous
// period, and the latest packages, quotes and messages. The server is mocked;
// the page's numbers come from the dashboard layout (useOutletContext).

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getDailySummary, getWarehouseBoard } from '../../api/staff';
import Overview from './Overview';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  getWarehouseBoard: vi.fn(),
  getDailySummary: vi.fn(),
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: { name: 'Chris Office', email: 'chris@example.com' } }) }));

// What the dashboard layout hands the page.
const outlet = { overview: null, state: 'ready', reload: vi.fn(), days: 30, setDays: vi.fn() };
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useOutletContext: () => outlet,
}));

const BUSY = {
  period_days: 30,
  ranges: [7, 30, 90],
  daily: [
    { date: '2026-10-24', quotes: 1, packages: 2, messages: 0 },
    { date: '2026-10-25', quotes: 3, packages: 1, messages: 2 },
  ],
  // Every kind of change: up from zero, up, down, flat, and none at all.
  quotes: { new: 2, recent: 5, trend: { current: 5, previous: 0 }, by_status: { new: 2 } },
  messages: { unhandled: 1, recent: 3, trend: { current: 3, previous: 2 } },
  packages: {
    total: 10,
    in_transit: 4,
    recent: 6,
    delivered: 5,
    trend: { current: 2, previous: 4 },
    by_status: { quoted: 1, delivered: 5 },
  },
  customers: { total: 40, trend: { current: 7, previous: 7 } },
  invoices: { pending_review: 1, recent: 2, sent: 3, total: 6, trend: { current: 3, previous: 2 } },
  bookings: { new: 1 },
  documents: { unattached: 0 },
  recent_packages: [
    {
      id: 1,
      tracking_number: 'PLSM-00001',
      description: 'Two boxes',
      customer: { name: 'Maria Martina', email: 'maria@example.com' },
      weight_kg: '12.5',
      value_eur: '240.00',
      warehouse_stage_display: 'Packed',
      created_at: '2026-10-25T10:00:00Z',
      status: 'in_transit',
      status_display: 'In transit',
    },
    {
      id: 2,
      tracking_number: 'PLSM-00002',
      description: '',
      customer: null,
      measurement: { weight_kg: '3.0' },
      value_eur: null,
      warehouse_stage_display: null,
      created_at: '2026-10-24T10:00:00Z',
      status: 'quoted',
      status_display: 'Quote sent',
    },
  ],
  recent_quotes: [
    { id: 7, full_name: 'Jan de Vries', destination: 'Bonaire', status: 'new', status_display: 'New', created_at: '2026-10-25T09:00:00Z' },
  ],
  recent_messages: [
    { id: 4, subject: 'Prijs', name: 'Anna', handled: false, created_at: '2026-10-25T08:00:00Z' },
    { id: 5, subject: 'Bedankt', name: 'Piet', handled: true, created_at: '2026-10-24T08:00:00Z' },
  ],
};

const QUIET = {
  ...BUSY,
  quotes: { new: 0, recent: 0, trend: null, by_status: {} },
  messages: { unhandled: 0, recent: 0, trend: null },
  invoices: undefined,
  bookings: undefined,
  documents: undefined,
  packages: { by_status: {}, trend: null },
  customers: {},
  recent_packages: [],
  recent_quotes: [],
  recent_messages: [],
};

beforeEach(() => {
  outlet.overview = BUSY;
  outlet.state = 'ready';
  outlet.setDays.mockReset();
  getDailySummary.mockReset().mockResolvedValue({ date: '2026-10-25', day: {}, open: {}, attention: [], customs: [] });
  getWarehouseBoard.mockReset().mockResolvedValue({
    measured_today: 3,
    waiting_measurement: 2,
    waiting_packaging: 0,
    ready_for_shipment: 1,
    damaged: 1,
    attention: 0,
  });
});

describe('Overview', () => {
  it('shows a busy day: queues, figures, the warehouse and the latest of everything', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Overview />);

    // 2 quotes + 1 message + 1 invoice + 1 booking waiting.
    expect(screen.getByText(/, Chris$/)).toBeInTheDocument();
    expect(screen.getByText(/5 .*waiting|waiting.*5/i)).toBeInTheDocument();

    // The changes from the previous period, each kind.
    expect(screen.getByText(/\+50%/)).toBeInTheDocument();
    expect(screen.getByText(/-50%/)).toBeInTheDocument();

    // The warehouse panel, once its own request answers: 3 measured today.
    const measured = await screen.findByText(/measured today/i);
    expect(within(measured.closest('p')).getByText('3')).toBeInTheDocument();

    // The latest packages, quotes and messages.
    const table = screen.getByRole('table');
    expect(within(table).getByText('PLSM-00001')).toBeInTheDocument();
    expect(within(table).getByText('Maria Martina')).toBeInTheDocument();
    expect(within(table).getByText('PLSM-00002')).toBeInTheDocument();
    expect(screen.getByText('Jan de Vries')).toBeInTheDocument();
    expect(screen.getByText('Anna')).toBeInTheDocument();

    // A different period is asked of the layout.
    await user.selectOptions(screen.getByRole('combobox'), '7');
    expect(outlet.setDays).toHaveBeenCalledWith(7);
  });

  it('shows a quiet day with nothing waiting and empty lists', async () => {
    outlet.overview = QUIET;
    getWarehouseBoard.mockRejectedValue(new Error('down'));
    renderWithProviders(<Overview />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The warehouse panel says it could not load, the rest of the page stands.
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('shows the loading state, then a connection error without an overview', () => {
    outlet.overview = null;
    outlet.state = 'loading';
    const { unmount } = renderWithProviders(<Overview />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    unmount();

    outlet.state = 'error';
    renderWithProviders(<Overview />);
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('exports the chart figures as a CSV file', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<Overview />);

    await user.click(screen.getByRole('button', { name: /csv/i }));

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
