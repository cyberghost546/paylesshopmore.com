// src/pages/Warehouse/DamageReport.jsx
//
// One damage report: what kind, who reported it and when, its photos, and -
// while it is open - Resolve, to close it with a note of what was done. Shown
// on the package's own page (PackagePage.jsx), under "Report damage".

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../../api/client';
import StoredPhoto from '../../components/StoredPhoto/StoredPhoto';
import { errorMessage, resolveDamageReport } from '../../api/warehouse';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { Message } from './opsUi';
import { whoAndWhen } from './when';
import styles from './Ops.module.css';

/**
 * @param {{ report: object, onResolved: (report: object) => void, showPackage?: boolean }} props
 *   showPackage  name the package with a link to it - off on the package's
 *                own page, where that would be a link to itself
 */
export default function DamageReport({ report, onResolved, showPackage = true }) {
  const { t } = useLanguage();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function resolve(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onResolved(await resolveDamageReport(report.id, note.trim()));
    } catch (caught) {
      setError(errorMessage(caught, t('dashboard.flow.damagePage.resolveError'), t));
      setBusy(false);
    }
  }

  const open = report.resolution_status === 'open';

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{t(`dashboard.flow.damage.types.${report.damage_type}`)}</h2>
        <span className={open ? styles.flag : styles.statusPill}>{t(`dashboard.flow.damagePage.${report.resolution_status}`)}</span>
      </div>

      <p className={styles.rowDetail}>
        {showPackage && (
          <>
            <Link to={`/warehouse/packages/${report.package.id}`} className={styles.rowTitle}>
              {report.package.tracking_number}
            </Link>
            {report.package.customer && ` · ${report.package.customer}`}
            {' · '}
          </>
        )}
        {fill(t('dashboard.flow.damagePage.reportedBy'), { who: whoAndWhen(report) })}
      </p>

      {report.description && <p className={styles.eventDetail}>{report.description}</p>}

      {report.photos.length > 0 && (
        <div className={styles.photos}>
          {report.photos.map((photo, index) => (
            <a key={photo.id} href={apiUrl(photo.url)} target="_blank" rel="noreferrer">
              <StoredPhoto
                src={apiUrl(photo.url)}
                alt={fill(t('dashboard.flow.damage.photo'), { number: index + 1 })}
                className={styles.photo}
              />
            </a>
          ))}
        </div>
      )}

      {!open && (
        <p className={styles.rowDetail}>
          {fill(t('dashboard.flow.damagePage.resolvedBy'), { name: report.resolved_by?.name ?? '' })}
          {report.resolution_note && `: ${report.resolution_note}`}
        </p>
      )}

      <Message tone="error">{error}</Message>

      {open &&
        (resolving ? (
          <form onSubmit={resolve} className={`${styles.fields} ${styles.alignEnd}`}>
            <label className={styles.field}>
              <span className={styles.label}>{t('dashboard.flow.damagePage.whatDone')}</span>
              <input
                className={styles.input}
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                autoFocus
              />
            </label>
            <div className={styles.buttonRow}>
              <button type="submit" className={styles.success} disabled={busy}>
                {busy ? t('dashboard.flow.common.saving') : t('dashboard.flow.damagePage.markResolved')}
              </button>
              <button type="button" className={styles.secondary} onClick={() => setResolving(false)}>
                {t('dashboard.flow.common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className={styles.secondary} onClick={() => setResolving(true)}>
            {t('dashboard.flow.damagePage.resolve')}
          </button>
        ))}
    </article>
  );
}
