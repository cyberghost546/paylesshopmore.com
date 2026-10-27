// Dashboard -> Overview: the daily summary card. The numbers show first; the
// AI's "Start with" lines arrive in a second request and are left out when
// the AI is off.

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { getDailySummary } from '../../api/staff';
import { DailySummary } from './Overview';

vi.mock('../../api/staff', async (importOriginal) => ({
  ...(await importOriginal()),
  getDailySummary: vi.fn(),
}));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: null }) }));

const SUMMARY = {
  date: '2026-10-25',
  day: { bookings: 3, messages: 2, quote_requests: 1, prealerts: 4, prealerts_arrived: 2, shipped: 5, delivered: 1 },
  open: { messages_unanswered: 2 },
  attention: [
    { tracking_number: 'PLSM-0001', stage: 'Package received', days_in_stage: 3, reason: 'waiting too long in this stage' },
  ],
};

beforeEach(() => {
  getDailySummary.mockReset();
});

describe('DailySummary', () => {
  it("shows yesterday, the stuck shipments and the AI's lines", async () => {
    getDailySummary.mockImplementation(({ highlights } = {}) =>
      Promise.resolve(highlights ? { ...SUMMARY, highlights: '- Answer the 2 open messages.\n- Chase PLSM-0001.' } : SUMMARY),
    );
    renderWithProviders(<DailySummary />);

    expect(await screen.findByRole('heading', { name: 'Daily summary' })).toBeInTheDocument();
    expect(screen.getByText('New bookings').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('PLSM-0001')).toBeInTheDocument();
    expect(screen.getByText(/waiting too long in this stage/)).toBeInTheDocument();
    expect(await screen.findByText('Answer the 2 open messages.')).toBeInTheDocument();
    expect(screen.getByText('Chase PLSM-0001.')).toBeInTheDocument();
  });

  it('leaves the AI part out when it is off', async () => {
    getDailySummary.mockImplementation(({ highlights } = {}) =>
      Promise.resolve(highlights ? { ...SUMMARY, highlights: '' } : SUMMARY),
    );
    renderWithProviders(<DailySummary />);

    await screen.findByRole('heading', { name: 'Daily summary' });
    await vi.waitFor(() => expect(getDailySummary).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Start with')).not.toBeInTheDocument();
    expect(screen.queryByText(/The AI is writing/)).not.toBeInTheDocument();
  });
});
