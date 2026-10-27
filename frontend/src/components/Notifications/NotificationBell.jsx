// src/components/Notifications/NotificationBell.jsx
//
// The bell in the header: a red count of unread notifications, and a list
// of the latest ones when clicked. Clicking one marks it read and goes to
// the right place on the profile page. Only shows for a signed-in customer
// (see NotificationsProvider) - for anyone else it renders nothing.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { BellIcon } from '../Icons/icons';
import { useNotifications } from './context';
import { describeNotification } from './notificationText';
import styles from './Notifications.module.css';

const SHOWN = 8;

/** @param {{ className?: string, onNavigate?: () => void }} props */
export default function NotificationBell({ className, onNavigate }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { enabled, items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  // Closes on a click outside it, and on Escape.
  useEffect(() => {
    if (!open) return undefined;
    function onClick(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!enabled) return null;

  const when = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const label =
    unread > 0 ? fill(t('notifications.bellUnread'), { count: unread }) : t('notifications.bell');

  return (
    <div className={`${styles.bellWrap} ${className ?? ''}`} ref={root}>
      <button
        type="button"
        className={styles.bell}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon size={22} />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label={t('notifications.title')}>
          <div className={styles.panelHead}>
            <p className={styles.panelTitle}>{t('notifications.title')}</p>
            {unread > 0 && (
              <button type="button" className={styles.readAll} onClick={markAllRead}>
                {t('notifications.readAll')}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className={styles.empty}>{t('notifications.empty')}</p>
          ) : (
            <ul className={styles.list}>
              {items.slice(0, SHOWN).map((item) => {
                const { title, text, link } = describeNotification(item, t);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={item.is_read ? styles.item : `${styles.item} ${styles.itemUnread}`}
                      onClick={() => {
                        markRead(item.id);
                        setOpen(false);
                        onNavigate?.();
                        navigate(link);
                      }}
                    >
                      {!item.is_read && <span className={styles.dot} aria-hidden="true" />}
                      <span className={styles.itemText}>
                        <span className={styles.itemTitle}>{title}</span>
                        <span className={styles.itemLine}>{text}</span>
                        <span className={styles.itemWhen}>
                          {when.format(new Date(item.created_at))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
