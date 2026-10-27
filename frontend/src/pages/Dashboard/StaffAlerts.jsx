// src/pages/Dashboard/StaffAlerts.jsx
//
// READ THIS FIRST
// ---------------
// Pop-ups in the top-right corner of the office dashboard that say
// "New message from Anna" or "New booking from Ben", so the office notices new
// work without having to keep refreshing the Messages and Bookings pages.
//
// It is the staff twin of the customer alerts
// (components/Notifications/NotificationsProvider.jsx) and borrows their look
// (Notifications.module.css), so both kinds of pop-up feel the same.
//
// How "new" is found, step by step:
//   1. Every POLL_MS we ask the server for the unhandled contact messages and
//      the bookings still on status "new" (api/staff.js, *ForAlerts).
//   2. We compare their ids with the ids this browser has ALREADY SEEN
//      (kept in localStorage under SEEN_KEY, one list per staff account).
//   3. Any id we have not seen yet gets a pop-up, and is added to "seen", so
//      the same message never pops up twice - not even after a page reload.
//   4. The very first time a browser opens the dashboard there is no "seen"
//      list yet. Then everything that is already waiting is quietly marked as
//      seen instead of popping up: those are not *new*, and the sidebar's
//      count pills already show them. Only what arrives after that pops up.
//
// Extras:
//   - A short, soft "ding" plays with each batch of new pop-ups (browsers only
//     allow sound after the person has clicked somewhere on the page, so it
//     may stay silent right after opening the tab - that is fine).
//   - While the tab is in the background, its title gets a counter, e.g.
//     "(2) PayLesShopMore", so a new message is noticed from another tab.
//     The counter goes away as soon as the tab is looked at again.
//   - `onNew` is called whenever something new arrives, so the dashboard can
//     refresh the sidebar's count pills straight away.
//
// "View" on a pop-up opens the Messages or Bookings page searched on that
// sender's e-mail address, so the new item is right at the top. The × only
// closes the pop-up. A pop-up also closes by itself after ALERT_MS.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listNewBookingsForAlerts, listNewMessagesForAlerts } from '../../api/staff';
import { CloseIcon } from '../../components/Icons/icons';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { BookmarkIcon, MailIcon } from './icons';
import styles from '../../components/Notifications/Notifications.module.css';

const POLL_MS = 30 * 1000; // ask the server every 30 seconds
const ALERT_MS = 20 * 1000; // a pop-up closes by itself after 20 seconds
const MAX_ALERTS = 4; // never more than 4 pop-ups on screen at once
const SEEN_KEY = 'plsm.staffAlerts.seen';

/**
 * The ids this browser has already seen, for one staff account.
 *
 * Stored shape (one entry per account id):
 *   { "7": { "messages": [12, 13], "bookings": [40] } }
 *
 * Returns null when nothing is stored yet for this account - that is how
 * step 4 above knows it is the very first visit.
 */
function readSeen(userId) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}');
    const mine = stored?.[String(userId)];
    if (!mine) return null;
    return {
      messages: new Set(Array.isArray(mine.messages) ? mine.messages : []),
      bookings: new Set(Array.isArray(mine.bookings) ? mine.bookings : []),
    };
  } catch {
    // Storage blocked (private window) or broken JSON: act like a first visit.
    return null;
  }
}

function saveSeen(userId, seen) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}');
    // Only the newest few hundred ids are kept; older ones are long handled,
    // and this stops the list from growing forever.
    stored[String(userId)] = {
      messages: [...seen.messages].slice(-300),
      bookings: [...seen.bookings].slice(-300),
    };
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(stored));
  } catch {
    // Then a pop-up may show once more after a reload. Harmless.
  }
}

/** A short two-tone "ding", made in the browser, so no sound file is needed. */
function playDing() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const audio = new AudioContext();
    // Two notes, one after the other: 880 Hz, then 1320 Hz.
    [880, 1320].forEach((frequency, index) => {
      const start = audio.currentTime + index * 0.15;
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.frequency.value = frequency;
      // Start quiet, and fade out quickly, so it is a soft "ding", not a beep.
      volume.gain.setValueAtTime(0.15, start);
      volume.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      tone.connect(volume);
      volume.connect(audio.destination);
      tone.start(start);
      tone.stop(start + 0.3);
    });
    // Free the audio device once both notes are done.
    window.setTimeout(() => audio.close().catch(() => {}), 1000);
  } catch {
    // No sound possible (blocked, or no audio device). The pop-up is enough.
  }
}

/**
 * Turns a message or booking row from the server into what a pop-up shows.
 *
 * Example: a message { id: 12, name: 'Anna', subject: 'Prijs', email: 'a@x.nl' }
 * becomes { key: 'message-12', kind: 'message', name: 'Anna',
 *           detail: 'Prijs', link: '/dashboard/messages?search=a%40x.nl' }
 */
function toAlert(kind, row) {
  if (kind === 'message') {
    return {
      key: `message-${row.id}`,
      kind,
      name: row.name || row.email || '',
      detail: row.subject || '',
      link: `/dashboard/messages?search=${encodeURIComponent(row.email || row.name || '')}`,
    };
  }
  return {
    key: `booking-${row.id}`,
    kind,
    name: row.sender_name || row.sender_email || '',
    detail: row.destination_label || '',
    link: `/dashboard/bookings?search=${encodeURIComponent(row.sender_email || row.sender_name || '')}`,
  };
}

/** One pop-up in the corner. Closes itself after ALERT_MS. */
function Alert({ alert, onOpen, onClose }) {
  const { t } = useLanguage();
  const isMessage = alert.kind === 'message';
  const title = t(isMessage ? 'dashboard.office.alerts.newMessage' : 'dashboard.office.alerts.newBooking');
  // fill() puts the name into the sentence: 'From {name}' -> 'From Anna'.
  const text = fill(t(isMessage ? 'dashboard.office.alerts.messageFrom' : 'dashboard.office.alerts.bookingFrom'), {
    name: alert.name,
  });

  // onClose never changes (useCallback), so this timer starts once per pop-up.
  useEffect(() => {
    const timer = window.setTimeout(() => onClose(alert.key), ALERT_MS);
    return () => window.clearTimeout(timer);
  }, [alert.key, onClose]);

  return (
    <div className={styles.alert} role="status">
      <span className={styles.alertIcon} aria-hidden="true">
        {isMessage ? <MailIcon /> : <BookmarkIcon />}
      </span>
      <div className={styles.alertBody}>
        <p className={styles.alertTitle}>{title}</p>
        <p className={styles.alertText}>
          {text}
          {alert.detail && (
            <>
              <br />
              <strong>{alert.detail}</strong>
            </>
          )}
        </p>
        <button type="button" className={styles.alertOpen} onClick={onOpen}>
          {t('dashboard.office.alerts.open')}
        </button>
      </div>
      <button
        type="button"
        className={styles.alertClose}
        onClick={() => onClose(alert.key)}
        aria-label={t('dashboard.office.alerts.close')}
        title={t('dashboard.office.alerts.close')}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

/**
 * Put this once inside the dashboard shell (DashboardLayout.jsx).
 *
 * @param {{ userId: number, onNew?: () => void }} props
 *   userId - the signed-in staff account, so each colleague sharing a browser
 *            keeps their own "seen" list.
 *   onNew  - called when at least one new message or booking arrived.
 */
export default function StaffAlerts({ userId, onNew }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // The pop-ups showing right now, newest first.
  const [alerts, setAlerts] = useState([]);
  // What this browser has seen already (see readSeen). A ref, not state: it
  // changes on every poll but nothing on screen depends on it directly.
  const seen = useRef(readSeen(userId));
  // How many new items arrived while the tab was in the background.
  const [unseenWhileHidden, setUnseenWhileHidden] = useState(0);
  // Keep the newest onNew in a ref, so a new function from the parent does
  // not restart the polling timer below.
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  }, [onNew]);

  const check = useCallback(async () => {
    let messages;
    let bookings;
    try {
      [messages, bookings] = await Promise.all([listNewMessagesForAlerts(), listNewBookingsForAlerts()]);
    } catch {
      return; // Offline, or signed out: simply try again at the next poll.
    }

    // Step 4: the first visit in this browser - remember everything, show nothing.
    if (seen.current === null) {
      seen.current = {
        messages: new Set(messages.results.map((row) => row.id)),
        bookings: new Set(bookings.results.map((row) => row.id)),
      };
      saveSeen(userId, seen.current);
      return;
    }

    // Steps 2 and 3: keep only the rows whose id we have not seen before.
    const fresh = [];
    for (const row of messages.results) {
      if (seen.current.messages.has(row.id)) continue;
      seen.current.messages.add(row.id);
      fresh.push(toAlert('message', row));
    }
    for (const row of bookings.results) {
      if (seen.current.bookings.has(row.id)) continue;
      seen.current.bookings.add(row.id);
      fresh.push(toAlert('booking', row));
    }
    if (fresh.length === 0) return;

    saveSeen(userId, seen.current);
    setAlerts((current) => [...fresh, ...current].slice(0, MAX_ALERTS));
    playDing();
    if (document.visibilityState !== 'visible') {
      setUnseenWhileHidden((count) => count + fresh.length);
    }
    onNewRef.current?.();
  }, [userId]);

  // Ask straight away, then every POLL_MS - also while the tab is in the
  // background, so the title counter and the ding can tell staff working in
  // another tab. Also ask the moment somebody comes back to the tab.
  useEffect(() => {
    // A timer, so state is only ever set from a callback, not during the effect.
    const first = window.setTimeout(check, 0);
    const timer = window.setInterval(check, POLL_MS);
    function onVisible() {
      if (document.visibilityState === 'visible') {
        setUnseenWhileHidden(0);
        check();
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  // The "(2) " in front of the tab title while the tab is in the background.
  // The original title is put back when the counter returns to 0.
  useEffect(() => {
    if (unseenWhileHidden === 0) return undefined;
    const original = document.title;
    document.title = `(${unseenWhileHidden}) ${original}`;
    return () => {
      document.title = original;
    };
  }, [unseenWhileHidden]);

  const closeAlert = useCallback((key) => {
    setAlerts((list) => list.filter((alert) => alert.key !== key));
  }, []);

  return (
    // aria-live: a screen reader reads a new pop-up out as it arrives.
    <div className={styles.alerts} aria-live="polite" aria-label={t('dashboard.office.alerts.label')}>
      {alerts.map((alert) => (
        <Alert
          key={alert.key}
          alert={alert}
          onClose={closeAlert}
          onOpen={() => {
            closeAlert(alert.key);
            navigate(alert.link);
          }}
        />
      ))}
    </div>
  );
}
