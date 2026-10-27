// src/pages/Dashboard/CustomsCheck.jsx
//
// "Customs check", opened under a shipment's row on the office Packages page:
// is the paperwork ready for customs on the island? (backend
// staff/customs_check.py)
//
//   1. The verdict and what is wrong - from fixed rules on our own data, so
//      the same shipment always gets the same answer: Not ready for customs
//      (customs will refuse it), Check before it leaves, or Paperwork complete.
//   2. "Do the documents match?" - a few AI-written lines comparing what is
//      declared with what the invoices say. Asked for separately, so the rules
//      show at once; left out when the AI is off. It never changes the verdict.
//
// Nothing here changes anything: it only reads.

import { useEffect, useState } from 'react';
import { getCustomsCheck } from '../../api/staff';
import { formatMoney } from './format';
import { StatusBadge } from './ui';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

// The dashboard's badge meanings (statuses.js): red, amber, green.
const TONES = { missing: 'off', check: 'attention', ok: 'done' };

/** One problem in the dashboard's language; the server's English if a code is new. */
function issueText(issue, k) {
  if (issue.code === 'emigration_papers') {
    const missing = [
      issue.params?.id_missing && k('issues.emigration_id'),
      issue.params?.deregistration_missing && k('issues.emigration_deregistration'),
    ].filter(Boolean);
    return `${k('issues.emigration_papers')} ${missing.join(', ')}.`;
  }
  const key = `issues.${issue.code}`;
  const text = k(key, issue.params);
  return text.endsWith(key) ? issue.message : text;
}

/** @param {{ packageId: number }} props */
export default function CustomsCheck({ packageId }) {
  const d = usePageText('packages');
  const k = (key, values) => d(`customs.${key}`, values);
  const [answer, setAnswer] = useState({ status: 'loading', data: null });
  // null while the AI is writing; '' when it is off or failed (then hidden).
  const [notes, setNotes] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getCustomsCheck(packageId)
      .then((data) => !cancelled && setAnswer({ status: 'ready', data }))
      .catch(() => !cancelled && setAnswer({ status: 'error', data: null }));
    getCustomsCheck(packageId, { ai: true })
      .then((data) => !cancelled && setNotes(data.ai_notes ?? ''))
      .catch(() => !cancelled && setNotes(''));
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  if (answer.status === 'loading') return <p className={styles.mutedCell}>{k('loading')}</p>;
  if (answer.status === 'error') return <p className={styles.mutedCell}>{k('failed')}</p>;

  const { verdict, issues, declared_eur: declared, invoices_eur: invoices, documents } = answer.data;
  const lines = (notes ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean);

  return (
    <section className={styles.customsCheck} aria-label={k('title')}>
      <div className={styles.customsHead}>
        <h3 className={styles.historyTitle}>{k('title')}</h3>
        <StatusBadge tone={TONES[verdict]}>{k(`verdict.${verdict}`)}</StatusBadge>
      </div>

      {issues.length > 0 && (
        <ul className={styles.customsIssues}>
          {issues.map((issue, index) => (
            <li
              // A code can repeat (one line per order), so the index is part of the key.
              key={`${issue.code}-${index}`}
              className={issue.level === 'block' ? styles.customsBlock : styles.customsWarn}
            >
              {issueText(issue, k)}
            </li>
          ))}
        </ul>
      )}

      <dl className={styles.customsFigures}>
        <div>
          <dt>{k('declared')}</dt>
          <dd>{declared ? formatMoney(declared) : k('none')}</dd>
        </div>
        <div>
          <dt>{k('invoices')}</dt>
          <dd>{invoices ? formatMoney(invoices) : k('none')}</dd>
        </div>
        <div>
          <dt>{k('documentsLabel')}</dt>
          <dd className={styles.customsSmall}>
            {k('documents', {
              read: documents.read,
              unread: documents.unread,
              prealert: documents.prealert_files,
            })}
          </dd>
        </div>
      </dl>

      {notes === null && <p className={styles.mutedCell}>{k('aiWriting')}</p>}
      {lines.length > 0 && (
        <div className={styles.summaryStart}>
          <h4 className={styles.summaryHeading}>{k('aiTitle')}</h4>
          <ul className={styles.summaryLines}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className={styles.customsSmall}>{k('aiNote')}</p>
        </div>
      )}
    </section>
  );
}
