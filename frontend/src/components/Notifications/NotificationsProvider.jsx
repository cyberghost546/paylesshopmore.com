// src/components/Notifications/NotificationsProvider.jsx
//
// Keeps the signed-in customer's notifications ("your shipment is on its
// way", "a new invoice is ready") and shows an ALERT in the top-right corner
// when a new one comes in. The bell in the header (NotificationBell.jsx)
// reads the same list through useNotifications().
//
// How "new" is found:
//   - The list is fetched when the customer signs in, every POLL_MS while
//     the tab is visible, and again the moment they come back to the tab.
//   - Every unread notification that has not been alerted before gets an
//     alert. Which ones were alerted is remembered in this browser
//     (ALERTED_KEY), so an alert shows once - not on every page.
//   - At most MAX_ALERTS at a time, newest first; the rest are still under
//     the bell.
//
// The alert's "Bekijken" marks it read and goes to the right place on the
// profile page; its × only closes the alert (it stays unread under the bell).
// An alert also closes by itself after ALERT_MS.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../api/notifications';
import { useAuth } from '../../auth/useAuth';
import { useLanguage } from '../../i18n/useLanguage';
import { BellIcon, CloseIcon } from '../Icons/icons';
import { NotificationsContext } from './context';
import { describeNotification } from './notificationText';
import styles from './Notifications.module.css';

const POLL_MS = 30 * 1000;
const ALERT_MS = 15 * 1000;
const MAX_ALERTS = 3;
const ALERTED_KEY = 'plsm.notifications.alerted';

/** The ids already alerted for this account, in this browser. */
function readAlerted(userId) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(ALERTED_KEY) ?? '{}');
    const ids = stored?.[String(userId)];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveAlerted(userId, ids) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(ALERTED_KEY) ?? '{}');
    // The newest few hundred are plenty; older ids are long read anyway.
    stored[String(userId)] = [...ids].slice(-300);
    window.localStorage.setItem(ALERTED_KEY, JSON.stringify(stored));
  } catch {
    // Then an alert may show once more next visit. Harmless.
  }
}

/** One alert in the corner. Closes itself after ALERT_MS. */
function Alert({ notification, onOpen, onClose }) {
  const { t } = useLanguage();
  const { title, text } = describeNotification(notification, t);

  // onClose is stable (useCallback) and takes the id, so this timer is not
  // restarted every time the page updates.
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(notification.id), ALERT_MS);
    return () => window.clearTimeout(timer);
  }, [notification.id, onClose]);

  return (
    <div className={styles.alert}>
      <span className={styles.alertIcon} aria-hidden="true">
        <BellIcon size={20} />
      </span>
      <div className={styles.alertBody}>
        <p className={styles.alertTitle}>{title}</p>
        <p className={styles.alertText}>{text}</p>
        <button type="button" className={styles.alertOpen} onClick={onOpen}>
          {t('notifications.open')}
        </button>
      </div>
      <button
        type="button"
        className={styles.alertClose}
        onClick={() => onClose(notification.id)}
        aria-label={t('notifications.closeAlert')}
        title={t('notifications.closeAlert')}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

/** The real provider, for one signed-in account (see the export below). */
function Provider({ userId, children }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  // The notifications showing as alerts right now.
  const [alerts, setAlerts] = useState([]);
  const alerted = useRef(readAlerted(userId));

  const load = useCallback(async () => {
    let result;
    try {
      result = await listNotifications();
    } catch {
      return; // Offline or signed out: try again at the next poll.
    }
    setItems(result.items);
    setUnread(result.unread);

    const fresh = result.items.filter((item) => !item.is_read && !alerted.current.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) alerted.current.add(item.id);
    saveAlerted(userId, alerted.current);
    setAlerts((current) => [...fresh, ...current].slice(0, MAX_ALERTS));
  }, [userId]);

  // On sign-in, every POLL_MS while the tab is visible, and on coming back.
  useEffect(() => {
    // The first look straight after mounting (a timer, so the state is only
    // ever set from a callback, not during the effect itself).
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  const markRead = useCallback((id) => {
    setItems((list) =>
      list.map((item) => (item.id === id && !item.is_read ? { ...item, is_read: true } : item)),
    );
    setUnread((count) => Math.max(0, count - 1));
    markNotificationRead(id).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setItems((list) => list.map((item) => ({ ...item, is_read: true })));
    setUnread(0);
    markAllNotificationsRead().catch(() => {});
  }, []);

  const closeAlert = useCallback((id) => {
    setAlerts((list) => list.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(
    () => ({ enabled: true, items, unread, markRead, markAllRead }),
    [items, unread, markRead, markAllRead],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {/* aria-live: a screen reader reads a new alert out as it arrives. */}
      <div className={styles.alerts} aria-live="polite">
        {alerts.map((notification) => (
          <Alert
            key={notification.id}
            notification={notification}
            onClose={closeAlert}
            onOpen={() => {
              closeAlert(notification.id);
              markRead(notification.id);
              navigate(describeNotification(notification, (key) => key).link);
            }}
          />
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

/**
 * Wrap the site in this. Does nothing for a visitor who is not signed in,
 * or when `enabled` is false (the staff screens).
 */
export default function NotificationsProvider({ enabled = true, children }) {
  const { user, isAuthenticated } = useAuth();
  if (!enabled || !isAuthenticated || !user?.id) return children;
  // Keyed on the account: signing in as someone else starts from nothing.
  return (
    <Provider key={user.id} userId={user.id}>
      {children}
    </Provider>
  );
}
