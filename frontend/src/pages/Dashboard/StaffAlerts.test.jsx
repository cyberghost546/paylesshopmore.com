// The pop-ups for a new contact message or booking in the office dashboard.
// What matters: what was already waiting on the first visit does NOT pop up,
// something that arrives later DOES (once), and "View" opens the right page.
//
// jsdom reports an English browser, so these read the English texts.

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { listNewBookingsForAlerts, listNewMessagesForAlerts } from '../../api/staff';
import StaffAlerts from './StaffAlerts';

vi.mock('../../api/staff', () => ({
  listNewMessagesForAlerts: vi.fn(),
  listNewBookingsForAlerts: vi.fn(),
}));

const oldMessage = { id: 1, name: 'Old Olga', email: 'olga@example.com', subject: 'Earlier' };
const newMessage = { id: 2, name: 'Anna', email: 'anna@example.com', subject: 'Price question' };
const newBooking = { id: 9, sender_name: 'Ben', sender_email: 'ben@example.com', destination_label: 'Curaçao' };

function page(results) {
  return { results, count: results.length };
}

function renderDashboard(onNew = () => {}) {
  return renderWithProviders(
    <>
      <StaffAlerts userId={7} onNew={onNew} />
      <Routes>
        <Route path="/dashboard" element={<p>Overview</p>} />
        <Route path="/dashboard/messages" element={<p>Messages page</p>} />
      </Routes>
    </>,
    { route: '/dashboard' },
  );
}

/** Lets the first check (a 0 ms timer) and its promises finish. */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.clear();
  listNewMessagesForAlerts.mockResolvedValue(page([oldMessage]));
  listNewBookingsForAlerts.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('StaffAlerts', () => {
  it('stays quiet about what was already waiting on the first visit', async () => {
    renderDashboard();
    await settle();

    expect(listNewMessagesForAlerts).toHaveBeenCalled();
    expect(screen.queryByText('New message')).not.toBeInTheDocument();
  });

  it('pops up once for a message and a booking that arrive later', async () => {
    const onNew = vi.fn();
    renderDashboard(onNew);
    await settle();

    listNewMessagesForAlerts.mockResolvedValue(page([newMessage, oldMessage]));
    listNewBookingsForAlerts.mockResolvedValue(page([newBooking]));
    await settle(30 * 1000);

    expect(screen.getByText('New message')).toBeInTheDocument();
    expect(screen.getByText('From Anna')).toBeInTheDocument();
    expect(screen.getByText('New booking')).toBeInTheDocument();
    expect(screen.getByText('From Ben')).toBeInTheDocument();
    expect(screen.queryByText('From Old Olga')).not.toBeInTheDocument();
    expect(onNew).toHaveBeenCalledTimes(1);

    // The pop-up closes by itself after 20 s, and the next poll (at 30 s)
    // sees the same rows: it does not come back, and onNew is not called again.
    await settle(30 * 1000);
    expect(screen.queryByText('New message')).not.toBeInTheDocument();
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('"View" opens the messages page', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDashboard();
    await settle();

    listNewMessagesForAlerts.mockResolvedValue(page([newMessage]));
    await settle(30 * 1000);

    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByText('Messages page')).toBeInTheDocument();
    expect(screen.queryByText('New message')).not.toBeInTheDocument();
  });
});
