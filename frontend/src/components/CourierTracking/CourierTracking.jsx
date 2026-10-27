// src/components/CourierTracking/CourierTracking.jsx
//
// One webshop order's courier tracking: where the parcel is on its way to our
// warehouse. Drawn from the `carrier_tracking` object the API puts on each
// booking order (backend/tracking/serializers.py), so it can be used anywhere
// an order is shown: the customer's booking pop-up, the "track a number" box,
// and the office's dashboard.
//
// One component for both legs of a parcel (`stage` on the object):
//   incoming  the webshop's courier, on its way to our warehouse;
//   outgoing  our shipment, on its way to the customer on the island.
//
// What it shows, top to bottom:
//   1. which leg, courier + tracking number (with a copy button), and the
//      current status as a badge;
//   2. a warning when something went wrong (failed delivery, delay, ...);
//   3. facts: last known location, expected delivery, last updated;
//   4. the timeline (ShipmentTimeline, the same one our own shipping uses);
//   5. the history, newest first. Each line says whether it came from the
//      courier ("Courier") or was typed by our team ("Our team"), so the
//      customer can tell verified data from ours. Lines made up by the mock
//      provider (development only) say "Test data", and so does the card,
//      so test data can never pass for real courier information.

import { useState } from 'react';
import ShipmentTimeline from '../ShipmentTimeline/ShipmentTimeline';
import { useLanguage } from '../../i18n/useLanguage';
import styles from './CourierTracking.module.css';

/**
 * @param {object} props
 * @param {object} props.tracking  the `carrier_tracking` object from the API
 * @param {boolean} [props.compact] smaller, for inside a list of orders
 * @param {number} [props.maxEvents] show only the newest N history lines
 */
export default function CourierTracking({ tracking, compact = false, maxEvents }) {
  const { t, language } = useLanguage();
  // True for a moment after the number was copied, to say so.
  const [copied, setCopied] = useState(false);
  if (!tracking) return null;

  // Copy the tracking number, e.g. to paste it on the courier's own site.
  // The clipboard is missing on old browsers and plain-http pages: then the
  // button simply does nothing (the number is on screen to select by hand).
  const copyNumber = () => {
    navigator.clipboard?.writeText(tracking.tracking_number).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  };

  // The status names in the reader's language. The server's English label is
  // the fallback for a status this page does not know yet.
  const statusLabel = (value, fallback) => {
    const key = `courier.status.${value}`;
    const text = t(key);
    return text === key ? fallback : text;
  };

  const date = (value, withTime = false) =>
    value
      ? new Intl.DateTimeFormat(language, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        }).format(new Date(value))
      : null;

  const stages = (tracking.timeline ?? []).map((stage) => ({
    value: stage.value,
    label: statusLabel(stage.value, stage.label),
  }));
  const events = maxEvents ? tracking.events.slice(0, maxEvents) : tracking.events;
  const badgeClass = tracking.problem
    ? `${styles.badge} ${styles.badgeProblem}`
    : tracking.status === 'delivered' || tracking.status === 'received_at_warehouse'
      ? `${styles.badge} ${styles.badgeDone}`
      : styles.badge;

  return (
    <section
      className={compact ? `${styles.card} ${styles.compact}` : styles.card}
      aria-label={t('courier.title')}
    >
      <div className={styles.head}>
        <div>
          {tracking.stage && (
            <p className={styles.stage}>
              {t(tracking.stage === 'outgoing' ? 'courier.stageOutgoing' : 'courier.stageIncoming')}
            </p>
          )}
          <p className={styles.label}>{tracking.carrier?.name ?? t('courier.unknownCarrier')}</p>
          <p className={styles.number}>
            {tracking.tracking_number}
            <button
              type="button"
              className={styles.copy}
              onClick={copyNumber}
              aria-label={t('courier.copyLabel')}
            >
              {copied ? t('courier.copied') : t('courier.copy')}
            </button>
          </p>
          {/* The courier's own page for this number (or 17TRACK's, which
              knows every courier). Built on the server with the number
              URL-encoded; opened in a new tab, without telling that site
              which page of ours it came from. */}
          {tracking.tracking_url && (
            <a
              className={styles.link}
              href={tracking.tracking_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('courier.openLink')} ↗
            </a>
          )}
        </div>
        <span className={badgeClass}>{statusLabel(tracking.status, tracking.status_display)}</span>
      </div>

      {tracking.test_data && (
        <p className={styles.testData} role="note">
          <strong>{t('courier.testData')}</strong> {t('courier.testDataNote')}
        </p>
      )}

      {tracking.problem && (
        // role="status": announced, but without interrupting like an alert.
        <p className={styles.problem} role="status">
          {t(`courier.problems.${tracking.problem.status}`)}
        </p>
      )}

      <dl className={styles.facts}>
        <div>
          <dt className={styles.label}>{t('courier.lastLocation')}</dt>
          <dd className={styles.value}>{tracking.last_location || t('courier.notKnown')}</dd>
        </div>
        <div>
          <dt className={styles.label}>
            {tracking.delivered_at ? t('courier.delivered') : t('courier.expected')}
          </dt>
          <dd className={styles.value}>
            {date(tracking.delivered_at ?? tracking.estimated_delivery) ?? t('courier.notKnown')}
          </dd>
        </div>
        <div>
          <dt className={styles.label}>{t('courier.lastUpdated')}</dt>
          <dd className={styles.value}>
            {date(tracking.last_synced_at, true) ?? t('courier.notYet')}
          </dd>
        </div>
      </dl>

      <ShipmentTimeline stages={stages} currentIndex={tracking.timeline_index} compact />

      <h3 className={styles.historyTitle}>{t('courier.history')}</h3>
      {events.length === 0 ? (
        <p className={styles.empty}>
          {tracking.automatic ? t('courier.noEventsYet') : t('courier.manualOnly')}
        </p>
      ) : (
        <ol className={styles.events}>
          {events.map((event) => (
            <li key={event.id} className={styles.event}>
              <span className={styles.eventTime}>
                {date(event.occurred_at, true) ?? t('courier.notKnown')}
              </span>
              <span className={styles.eventText}>
                {event.status && (
                  <strong>{statusLabel(event.status, event.status_display)}</strong>
                )}
                {event.description && <span>{event.description}</span>}
                {event.location && <span className={styles.eventPlace}>{event.location}</span>}
              </span>
              {/* Where the line came from: verified courier data, us, or
                  made-up test data. */}
              {event.test_data ? (
                <span className={styles.sourceTest}>{t('courier.testData')}</span>
              ) : (
                <span className={event.verified ? styles.sourceCourier : styles.sourceUs}>
                  {event.verified ? t('courier.sourceCourier') : t('courier.sourceUs')}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      {!tracking.automatic && events.length > 0 && (
        <p className={styles.note}>{t('courier.manualOnly')}</p>
      )}
    </section>
  );
}
