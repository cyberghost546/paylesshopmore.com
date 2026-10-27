// src/api/notifications.js
//
// The signed-in customer's notifications: "your shipment is on its way",
// "a new invoice is ready". The server raises them (backend
// notifications/services.py) when a shipment changes status or an invoice is
// sent; the site shows them as an alert and under the bell in the header
// (src/components/Notifications). The server only ever returns the asker's own.

import { request } from './client';

/**
 * @param {{ unread?: boolean }} [options] only the unread ones
 * @returns {Promise<{ items: object[], unread: number }>}
 */
export async function listNotifications({ unread = false } = {}) {
  const data = await request(`/notifications/${unread ? '?unread=1' : ''}`, {
    // A signed-out answer is normal when a session expires; not an incident.
    silentAuthFailure: true,
    // Fetched on a timer and on coming back to the tab, never because somebody
    // did something, so it must not keep a floor device's session awake.
    background: true,
  });
  const items = Array.isArray(data) ? data : (data?.results ?? []);
  return { items, unread: data?.unread ?? items.filter((item) => !item.is_read).length };
}

export async function markNotificationRead(id) {
  return request(`/notifications/${id}/read/`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return request('/notifications/read-all/', { method: 'POST' });
}
