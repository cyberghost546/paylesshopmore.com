// src/pages/Dashboard/sheet.jsx
//
// The building blocks of an opened record in the dashboard - a booking
// (Bookings.jsx) and a quote request (Quotes.jsx) - so both look the same:
// blue groups with a heading, fields with a small label over a big value,
// coloured labels for yes/no, and a progress line.
//
// Styles: the bk* classes at the end of Dashboard.module.css.

import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

/** A small label: blue for yes, grey for no or not given, red for a problem. */
export function Chip({ tone, children }) {
  return <span className={`${styles.bkChip} ${styles[`bkChip_${tone}`]}`}>{children}</span>;
}

/** One field: a small uppercase label over its value. `wide` spans the row. */
export function Field({ label, wide, children }) {
  return (
    <div className={wide ? styles.detailWide : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * One group of fields ("Sender", "Contact", ...): a blue line down its left
 * side and a blue heading. All groups share the one colour, so they read as
 * a single sheet.
 */
export function Group({ title, children }) {
  return (
    <section className={styles.bkGroup}>
      <p className={styles.bkGroupHead}>{title}</p>
      <dl className={styles.detailGrid}>{children}</dl>
    </section>
  );
}

/**
 * Where a record stands: done steps with a tick, the current one filled in,
 * later ones grey.
 *
 * @param {object} props
 * @param {[string, string][]} props.steps [value, label] in order
 * @param {string} props.status the record's status
 * @param {Record<string, string>} [props.stopped] statuses that end the
 *   journey early (cancelled, declined), with the sentence to show instead
 */
export function Progress({ steps, status, stopped = {} }) {
  const c = usePageText('common');
  if (stopped[status]) {
    return <p className={styles.bkCancelled}>{stopped[status]}</p>;
  }
  const current = steps.findIndex(([value]) => value === status);
  return (
    <ol className={styles.bkJourney} aria-label={c('progress')}>
      {steps.map(([value, label], index) => (
        <li
          key={value}
          className={
            index < current
              ? styles.bkStepDone
              : index === current
                ? styles.bkStepNow
                : styles.bkStepLater
          }
          aria-current={index === current ? 'step' : undefined}
        >
          <span className={styles.bkStepDot} aria-hidden="true">
            {index < current ? '✓' : index + 1}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}
