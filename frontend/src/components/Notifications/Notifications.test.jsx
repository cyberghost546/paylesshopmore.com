// The alert when a new notification comes in, and the bell in the header.
// What matters: a new one alerts once (not on every page), "View" marks it
// read and goes to the profile, and nothing happens for a signed-out visitor.
//
// jsdom reports an English browser, so these read the English texts.

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications';
import NotificationBell from './NotificationBell';
import NotificationsProvider from './NotificationsProvider';

vi.mock('../../api/notifications', () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

const auth = { user: { id: 7 }, isAuthenticated: true };
vi.mock('../../auth/useAuth', () => ({ useAuth: () => auth }));

const shipped = {
  id: 1,
  kind: 'shipment_status',
  context: { tracking_number: 'PLSM-1001', status: 'in_transit' },
  tracking_number: 'PLSM-1001',
  created_at: '2026-10-06T09:00:00Z',
  is_read: false,
};
const invoice = {
  id: 2,
  kind: 'invoice_sent',
  context: { tracking_number: 'PLSM-1001', invoice_number: 'INV-2026-00010' },
  tracking_number: 'PLSM-1001',
  created_at: '2026-10-06T08:00:00Z',
  is_read: true,
};

function renderSite(route = '/') {
  return renderWithProviders(
    <NotificationsProvider>
      <NotificationBell />
      <Routes>
        <Route path="/" element={<p>Home page</p>} />
        <Route path="/profile" element={<p>Profile page</p>} />
      </Routes>
    </NotificationsProvider>,
    { route },
  );
}

beforeEach(() => {
  auth.user = { id: 7 };
  auth.isAuthenticated = true;
  window.localStorage.clear();
  listNotifications.mockReset().mockResolvedValue({ items: [shipped, invoice], unread: 1 });
  markNotificationRead.mockReset().mockResolvedValue({});
  markAllNotificationsRead.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the alert', () => {
  it('pops up for a new unread notification, in words', async () => {
    renderSite();

    expect(await screen.findByText('Your shipment is on its way')).toBeInTheDocument();
    expect(screen.getByText('Shipment PLSM-1001')).toBeInTheDocument();
    // The invoice was already read: no alert for it.
    expect(screen.queryByText('New invoice')).toBeNull();
  });

  it('"View" marks it read and goes to the shipments on the profile', async () => {
    const user = userEvent.setup();
    renderSite();

    await user.click(await screen.findByRole('button', { name: 'View' }));

    expect(markNotificationRead).toHaveBeenCalledWith(1);
    expect(screen.getByText('Profile page')).toBeInTheDocument();
    expect(screen.queryByText('Your shipment is on its way')).toBeNull();
  });

  it('alerts only once, not again on the next page or visit', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSite();
    await user.click(await screen.findByRole('button', { name: 'Close notification' }));
    // Closing does not mark it read: it stays unread under the bell.
    expect(markNotificationRead).not.toHaveBeenCalled();
    unmount();

    renderSite();
    await waitFor(() => expect(listNotifications).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Your shipment is on its way')).toBeNull();
  });

  it('notices a new one that arrives later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listNotifications.mockResolvedValue({ items: [invoice], unread: 0 });
    renderSite();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();

    listNotifications.mockResolvedValue({ items: [shipped, invoice], unread: 1 });
    await act(() => vi.advanceTimersByTimeAsync(30 * 1000));

    expect(screen.getByText('Your shipment is on its way')).toBeInTheDocument();
  });

  it('does nothing for a visitor who is not signed in', async () => {
    auth.user = null;
    auth.isAuthenticated = false;
    renderSite();

    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(listNotifications).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
  });
});

describe('the bell', () => {
  it('shows the unread count and the list', async () => {
    const user = userEvent.setup();
    renderSite();

    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await user.click(bell);
    const panel = screen.getByRole('dialog', { name: 'Notifications' });

    expect(within(panel).getByText('Your shipment is on its way')).toBeInTheDocument();
    expect(within(panel).getByText('New invoice')).toBeInTheDocument();
    expect(
      within(panel).getByText('Invoice INV-2026-00010 for shipment PLSM-1001 is ready for you.'),
    ).toBeInTheDocument();
  });

  it('marks everything read', async () => {
    const user = userEvent.setup();
    renderSite();

    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

    expect(markAllNotificationsRead).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('goes to the invoices for an invoice notification', async () => {
    const user = userEvent.setup();
    renderSite();

    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(screen.getByRole('button', { name: /New invoice/ }));

    expect(markNotificationRead).toHaveBeenCalledWith(2);
    expect(screen.getByText('Profile page')).toBeInTheDocument();
  });
});
