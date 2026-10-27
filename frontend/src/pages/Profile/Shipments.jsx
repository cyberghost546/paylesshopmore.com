// src/pages/Profile/Shipments.jsx
//
// The customer's shipment history: one card per shipment, never one merged
// list of everything they have ever sent.
//
// At the top, the shipment that will arrive first ("Komt als eerste aan").
// Below it, the groups ("Nog te verzenden", "Onderweg", ...) fold open and
// closed like a dropdown: click the heading. Inside a group the shipments
// are split by the month they were ordered in, newest month first, and
// within a month the one arriving soonest comes first. Each shipment in them is a slim bar -
// order number, what is in it, status, one date. Clicking it opens a pop-up
// window (HelpDialog) with the details: how long it will still take, where
// it is, the facts and its invoice (ShipmentDetails.jsx).
//
// That separation is the point of the card rather than a layout preference.
// A customer who buys something after their first shipment has left ends up
// with two shipments, each with its own tracking number and its own journey,
// and the question they actually have — "which of my things is on which
// boat" — is only answerable if the page keeps them apart. A shipment that
// has gone is drawn as a record: its own notice, and nothing to press.

import { useEffect, useId, useState } from 'react';
import { listPackages } from '../../api/profile';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  ShipIcon,
} from '../../components/Icons/icons';
import { useLanguage } from '../../i18n/useLanguage';
import HelpDialog from '../../components/HelpDialog/HelpDialog';
import { fill } from '../../i18n/fill';
import ShipmentDetails from './ShipmentDetails';
import { lockText } from './shipmentLock';
import styles from './Profile.module.css';


// The three headings the list is split under, in the order they are shown,
// plus cancelled shipments at the very end. Which status goes where is only
// about presentation; the texts are profile.shipments.groups.<id>.
// Each group also has its own icon and colour (the colours are in
// Profile.module.css, under .shipmentGroup[data-group=...]).
// Which groups start open: the ones with something still happening. The
// history (received, cancelled) starts folded, showing only its count.
const OPEN_AT_START = ['toSend', 'onTheWay'];

const GROUPS = [
  {
    id: 'toSend',
    statuses: ['quoted', 'paid', 'purchased', 'ready_for_shipping'],
    Icon: ClockIcon,
  },
  { id: 'onTheWay', statuses: ['in_transit', 'arrived'], Icon: ShipIcon },
  { id: 'received', statuses: ['delivered'], Icon: CheckCircleIcon },
  { id: 'cancelled', statuses: ['cancelled'], Icon: CloseIcon },
];

/**
 * Which group a shipment belongs in. A status this list does not know yet
 * (one added on the server later) is placed by its dates instead, so it
 * still shows up somewhere sensible rather than disappearing.
 */


function groupOf(shipment) {
  const known = GROUPS.find((group) =>
    group.statuses.includes(shipment.status),
  );
  if (known) return known.id;
  if (shipment.delivered_at) return 'received';
  if (shipment.shipped_at) return 'onTheWay';
  return 'toSend';
}

/**
 * @param {object} props
 * @param {object[]} [props.invoices]  the customer's invoices, loaded by the
 *   profile page for "My invoices"; each shipment shows its own.
 */
const DAY = 24 * 60 * 60 * 1000;

/** '2026-10-15' as a local date (not UTC midnight, which can be a day off). */
function parseDay(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Whole days from today to a date, negative when it has passed. */
function daysFromToday(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / DAY);
}

/**
 * The shipment that will arrive first: of those still to be sent or on
 * their way, the one with the nearest expected arrival that is today or
 * later. Shipments already on the island are past that point; ones without
 * an expected date cannot be compared. Null when there is none.
 */
function nextArrival(shipments) {
  return (
    shipments
      .filter(
        (shipment) =>
          ['toSend', 'onTheWay'].includes(groupOf(shipment)) &&
          shipment.status !== 'arrived' &&
          shipment.estimated_arrival &&
          daysFromToday(parseDay(shipment.estimated_arrival)) >= 0,
      )
      // ISO dates sort correctly as text.
      .sort((a, b) =>
        a.estimated_arrival.localeCompare(b.estimated_arrival),
      )[0] ?? null
  );
}

/**
 * The order inside a group: received shipments newest delivery first;
 * cancelled newest first; everything else soonest expected arrival first
 * (those without a date after them), then newest order.
 */
function sortForGroup(groupId, list) {
  const newest = (a, b) => String(b).localeCompare(String(a));
  return [...list].sort((a, b) => {
    if (groupId === 'received') return newest(a.delivered_at, b.delivered_at);
    if (groupId === 'cancelled') return newest(a.created_at, b.created_at);
    if (a.estimated_arrival && b.estimated_arrival) {
      return a.estimated_arrival.localeCompare(b.estimated_arrival);
    }
    if (a.estimated_arrival) return -1;
    if (b.estimated_arrival) return 1;
    return newest(a.created_at, b.created_at);
  });
}

/**
 * The shipments split by the month they were ordered in (created_at),
 * newest month first, keeping the order they come in within each month.
 * Returns [{ key: '2026-10', date, items }].
 */
function byMonth(list) {
  const months = new Map();
  for (const shipment of list) {
    const ordered = new Date(shipment.created_at);
    const key = `${ordered.getFullYear()}-${String(ordered.getMonth() + 1).padStart(2, '0')}`;
    if (!months.has(key)) {
      months.set(key, {
        key,
        date: new Date(ordered.getFullYear(), ordered.getMonth(), 1),
        items: [],
      });
    }
    months.get(key).items.push(shipment);
  }
  return [...months.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export default function Shipments({ invoices = [] }) {
  const { t, language } = useLanguage();
  // Which shipment is open (its id), or null. One at a time.
  const [openId, setOpenId] = useState(null);
  // The groups that are unfolded, by id.
  const [openGroups, setOpenGroups] = useState(() => new Set(OPEN_AT_START));
  const idBase = useId();

  function toggleGroup(id) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [shipments, setShipments] = useState([]);
  // 'loading' | 'ready' | 'error'
  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    listPackages()
      .then((rows) => {
        if (cancelled) return;
        setShipments(rows);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      // Stops a slow response from landing after the visitor has moved on.
      cancelled = true;
    };
  }, [attempt]);

  // Date and time, e.g. "12 sep 2026, 16:30" - when a shipment left or
  // arrived is something customers plan around, so the time is shown too.
  const dateFormat = new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // A month, for the month headings: "oktober 2026".
  const monthFormat = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
  });
  // A full date, for "comes first": "8 oktober".
  const longDay = new Intl.DateTimeFormat(language, {
    day: 'numeric',
    month: 'long',
  });
  // Just the day, for the one date on a closed bar: "15 okt".
  const shortDay = new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
  });

  if (state === 'loading') {
    return (
      <p className={styles.invoiceMessage}>{t('profile.shipments.loading')}</p>
    );
  }

  if (state === 'error') {
    return (
      <p className={styles.failure} role="alert">
        {t('profile.shipments.failed')}{' '}
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => {
            setState('loading');
            setAttempt((n) => n + 1);
          }}
        >
          {t('profile.invoices.retry')}
        </button>
      </p>
    );
  }

  if (shipments.length === 0) {
    return (
      <p className={styles.invoiceMessage}>{t('profile.shipments.empty')}</p>
    );
  }

  // The status in the page's language. The server sends it in English
  // only (status_display); that stays the fallback for a status this page
  // has no translation for yet.
  function statusLabel(shipment) {
    // A finished shipment the customer came to collect says "Picked up",
    // not "Delivered" (handover: pickup).
    const status =
      shipment.status === 'delivered' && shipment.handover === 'pickup' ? 'picked_up' : shipment.status;
    const key = `profile.shipments.status.${status}`;
    const label = t(key);
    return label === key ? shipment.status_display : label;
  }

  // The shipment whose details are open in the pop-up, if any.
  const selected = shipments.find((shipment) => shipment.id === openId);

  // The one date on a closed bar: the one the customer cares about most
  // for that shipment.
  function barDate(shipment) {
    const say = (key, date) =>
      `${t(`profile.shipments.bar.${key}`)} ${shortDay.format(date)}`;
    if (shipment.delivered_at)
      return say('delivered', new Date(shipment.delivered_at));
    if (shipment.status === 'cancelled') return null;
    // Already on the island: an expected date would be in the past.
    if (shipment.status === 'arrived' && shipment.shipped_at)
      return say('shipped', new Date(shipment.shipped_at));
    if (shipment.estimated_arrival) {
      const [y, m, d] = shipment.estimated_arrival.split('-').map(Number);
      return say('expected', new Date(y, m - 1, d));
    }
    if (shipment.shipped_at)
      return say('shipped', new Date(shipment.shipped_at));
    return say('registered', new Date(shipment.created_at));
  }

  const next = nextArrival(shipments);

  // The countdown on the right of the "comes first" block: "nog 3 dagen"
  // (small, big number, small), or one word for today and tomorrow.
  function nextCountdown(shipment) {
    const days = daysFromToday(parseDay(shipment.estimated_arrival));
    if (days === 0) return { word: t('profile.shipments.next.today') };
    if (days === 1) return { word: t('profile.shipments.next.tomorrow') };
    return {
      before: t('profile.shipments.next.before'),
      number: days,
      unit: t('profile.shipments.next.unit'),
    };
  }

  const countdown = next ? nextCountdown(next) : null;

  // One shipment's bar. The whole bar is the button that opens the details
  // in a pop-up window.
  function renderBar(shipment) {
    const when = barDate(shipment);
    return (
      <li key={shipment.id} className={styles.shipment}>
        <button
          type="button"
          className={styles.shipmentBar}
          aria-haspopup="dialog"
          onClick={() => setOpenId(shipment.id)}
        >
          <span className={styles.shipmentBarMain}>
            <span className={styles.invoiceNumber}>
              {shipment.tracking_number}
              {/* The one arriving first, also marked in the list. */}
              {next?.id === shipment.id && (
                <span className={styles.shipmentNextBadge}>
                  {t('profile.shipments.next.badge')}
                </span>
              )}
            </span>
            {shipment.description && (
              <span className={styles.shipmentBarText}>
                {shipment.description}
              </span>
            )}
          </span>
          <span className={styles.shipmentBarSide}>
            <span className={styles.shipmentStatus}>
              {statusLabel(shipment)}
            </span>
            {when && <span className={styles.shipmentBarWhen}>{when}</span>}
          </span>
          <ChevronRightIcon size={20} className={styles.shipmentChevron} />
        </button>
      </li>
    );
  }

  return (
    <>
      <p className={styles.cardIntro}>{t('profile.shipments.intro')}</p>

      {/* "Comes first": the shipment with the nearest expected arrival,
          clickable like its bar. In its group's colours. */}
      {next && (
        <div className={styles.shipmentGroup} data-group={groupOf(next)}>
          <button
            type="button"
            className={styles.shipmentNext}
            aria-haspopup="dialog"
            onClick={() => setOpenId(next.id)}
          >
            <span className={styles.shipmentNextIcon}>
              <ShipIcon size={22} />
            </span>
            {/* What is in it as the title; the order number and the
                expected date small underneath. */}
            <span className={styles.shipmentNextMain}>
              <span className={styles.shipmentNextLabel}>
                {t('profile.shipments.next.label')}
              </span>
              <span className={styles.shipmentNextTitle}>
                {next.description || next.tracking_number}
              </span>
              <span className={styles.shipmentNextWhen}>
                {next.description ? `${next.tracking_number} · ` : ''}
                {fill(t('profile.shipments.next.expected'), {
                  date: longDay.format(parseDay(next.estimated_arrival)),
                })}
              </span>
            </span>
            {/* The countdown, big, so it is the first thing seen. */}
            <span className={styles.shipmentNextCountdown}>
              {countdown.word ? (
                <span className={styles.shipmentNextWord}>
                  {countdown.word}
                </span>
              ) : (
                <>
                  <span className={styles.shipmentNextSmall}>
                    {countdown.before}
                  </span>
                  <span className={styles.shipmentNextNumber}>
                    {countdown.number}
                  </span>
                  <span className={styles.shipmentNextSmall}>
                    {countdown.unit}
                  </span>
                </>
              )}
            </span>
          </button>
        </div>
      )}

      {/* One heading per group, with how many are in it. Empty groups are
          left out, so a customer with only delivered shipments sees only
          "Received". */}
      {GROUPS.map((group) => {
        const inGroup = shipments.filter(
          (shipment) => groupOf(shipment) === group.id,
        );
        if (inGroup.length === 0) return null;

        return (
          // data-group picks the group's colour in the CSS.
          <section
            key={group.id}
            className={styles.shipmentGroup}
            data-group={group.id}
          >
            {/* The heading is the button that folds the group open and
                closed; the arrow points down when it is open. */}
            <h3 className={styles.shipmentGroupTitle}>
              <button
                type="button"
                className={styles.shipmentGroupToggle}
                aria-expanded={openGroups.has(group.id)}
                aria-controls={`${idBase}-${group.id}`}
                onClick={() => toggleGroup(group.id)}
              >
                <span className={styles.shipmentGroupIcon}>
                  <group.Icon size={16} />
                </span>
                {t(`profile.shipments.groups.${group.id}`)}
                <span className={styles.shipmentGroupCount}>
                  {inGroup.length}
                </span>
                <ChevronRightIcon
                  size={20}
                  className={styles.shipmentGroupChevron}
                />
              </button>
            </h3>

            {/* Open: the shipments by the month they were ordered in. */}
            {openGroups.has(group.id) && (
              <div id={`${idBase}-${group.id}`}>
                {byMonth(sortForGroup(group.id, inGroup)).map((month) => (
                  <div key={month.key} className={styles.shipmentMonth}>
                    <h4 className={styles.shipmentMonthTitle}>
                      {fill(t('profile.shipments.orderedIn'), {
                        month: monthFormat.format(month.date),
                      })}
                      <span className={styles.shipmentMonthCount}>
                        {month.items.length}
                      </span>
                    </h4>
                    <ul className={styles.shipmentList}>
                      {month.items.map(renderBar)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* The details of the clicked shipment, in a pop-up window over the
          page. Closes with its button, the x, Escape or a click outside. */}
      {selected && (
        <HelpDialog
          open
          wide
          onClose={() => setOpenId(null)}
          title={`${t('profile.shipments.details.order')} ${selected.tracking_number}`}
          closeLabel={t('profile.shipments.details.close')}
          doneLabel={t('profile.shipments.details.close')}
        >
          {/* Inside the group's colours (see .shipmentGroup in the CSS),
              so the pop-up matches the bar that was clicked. */}
          <div className={styles.shipmentGroup} data-group={groupOf(selected)}>
            <div className={styles.shipmentPopupHead}>
              {selected.description && (
                <p className={styles.shipmentBarText}>{selected.description}</p>
              )}
              <span className={styles.shipmentStatus}>
                {statusLabel(selected)}
              </span>
            </div>
            <ShipmentDetails
              shipment={selected}
              invoices={invoices}
              dateFormat={dateFormat}
              lock={lockText(selected)}
              // The customer changed something (delivery or pickup): put the
              // server's new copy of the shipment in the list.
              onUpdated={(updated) =>
                setShipments((rows) => rows.map((row) => (row.id === updated.id ? updated : row)))
              }
            />
          </div>
        </HelpDialog>
      )}
    </>
  );
}
