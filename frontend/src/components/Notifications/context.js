// src/components/Notifications/context.js
//
// The context object and its hook, kept apart from the provider component
// so that file exports only a component (React Fast Refresh).

import { createContext, useContext } from 'react';

export const NotificationsContext = createContext(null);

/**
 * The customer's notifications, shared by the bell and the alerts.
 * Outside the provider (signed out, staff screens, tests) it returns an
 * empty, do-nothing value, so a component can always call it.
 */
export function useNotifications() {
  return (
    useContext(NotificationsContext) ?? {
      enabled: false,
      items: [],
      unread: 0,
      markRead: () => {},
      markAllRead: () => {},
    }
  );
}
