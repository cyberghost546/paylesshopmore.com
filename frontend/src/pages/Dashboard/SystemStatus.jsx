// src/pages/Dashboard/SystemStatus.jsx
//
// READ THIS FIRST
// ---------------
// "System": a quick check that the site's safety nets work, for admins.
// Three cards, each with a green "OK" or an orange/red warning:
//
//   1. Backups      - did last night's database backup work? (and a list of
//                     the last 10 attempts, with the reason when one failed)
//   2. Errors       - is Sentry on, so we hear about crashes?
//   3. E-mail       - can the site send real e-mail? (password resets,
//                     replies to messages, backup warnings all need it)
//
// Everything comes from GET /api/staff/system/ (backend ops/views.py).
// How to set each of these up is in docs/BACKUPS.md.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/system
//   Who can open: admins (the server refuses everybody else)
//   Links to:     nothing
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js (getSystemStatus)

import { useEffect, useState } from 'react';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import { getSystemStatus } from '../../api/staff';
import { useAuth } from '../../auth/useAuth';
import { formatDateTime, formatSize } from './format';
import { Banner, Empty, StatusBadge } from './ui';
import { usePageText } from './usePageText';
import styles from './Dashboard.module.css';

// How each backup status looks: a StatusBadge tone and its words.
const RUN_TONES = { ok: 'done', failed: 'attention', running: 'progress' };

/** One of the three cards: a title, a badge (OK / warning) and an explanation. */
function Check({ title, ok, okText, problemText, children }) {
  return (
    <section className={`${styles.panel} ${styles.systemCheck}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        <StatusBadge tone={ok ? 'done' : 'attention'}>{ok ? okText : problemText}</StatusBadge>
      </div>
      {children}
    </section>
  );
}

export default function SystemStatus() {
  const { user } = useAuth();
  const d = usePageText('system');
  const isAdmin = Boolean(user?.isAdmin);

  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState({ attempt: -1, status: 'loading', data: null });

  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    getSystemStatus()
      .then((data) => live && setAnswer({ attempt, status: 'ready', data }))
      .catch(() => live && setAnswer({ attempt, status: 'error', data: null }));
    return () => {
      live = false;
    };
  }, [isAdmin, attempt]);

  const header = (
    <header className={styles.head}>
      <h1 className={styles.title}>{d('title')}</h1>
      <p className={styles.subtitle}>{d('subtitle')}</p>
    </header>
  );

  // The server refuses non-admins anyway; this only says so nicely.
  if (!isAdmin) {
    return (
      <>
        {header}
        <Banner tone="info">{d('adminOnly')}</Banner>
      </>
    );
  }

  const state = answer.attempt === attempt ? answer.status : 'loading';
  if (state === 'loading') return <>{header}<Loading inline /></>;
  if (state === 'error') {
    return (
      <>
        {header}
        <ConnectionError inline onRetry={() => setAttempt((n) => n + 1)} />
      </>
    );
  }

  const { backups, error_monitoring: monitoring, email } = answer.data;
  // Backups are only "OK" when they go to a real bucket AND one worked recently.
  const backupsOk = backups.destination === 'bucket' && !backups.last_success_too_old;

  return (
    <>
      {header}

      <div className={styles.systemChecks}>
        <Check title={d('backupsTitle')} ok={backupsOk} okText={d('ok')} problemText={d('needsAttention')}>
          <p className={styles.panelLead}>
            {backups.destination === 'none' && d('backupsNotSetUp')}
            {backups.destination === 'folder' && d('backupsFolder')}
            {backups.destination === 'bucket' &&
              (backups.last_success_at
                ? d('backupsLast', { when: formatDateTime(backups.last_success_at) })
                : d('backupsNeverWorked'))}
            {backups.destination === 'bucket' && backups.last_success_at && backups.last_success_too_old && (
              <>
                {' '}
                <strong>{d('backupsTooOld')}</strong>
              </>
            )}
          </p>
          <p className={styles.bkHint}>{d('backupsKept', { days: backups.keep_days })}</p>
        </Check>

        <Check title={d('errorsTitle')} ok={monitoring.sentry} okText={d('on')} problemText={d('off')}>
          <p className={styles.panelLead}>{monitoring.sentry ? d('sentryOn') : d('sentryOff')}</p>
        </Check>

        <Check title={d('emailTitle')} ok={email.ready} okText={d('ok')} problemText={d('off')}>
          <p className={styles.panelLead}>{email.ready ? d('emailOn') : d('emailOff')}</p>
        </Check>
      </div>

      <section className={`${styles.panel} ${styles.section}`}>
        <h2 className={styles.panelTitle}>{d('recentBackups')}</h2>
        {backups.recent.length === 0 ? (
          <Empty>{d('noBackupsYet')}</Empty>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colStarted')}</th>
                  <th scope="col">{d('colStatus')}</th>
                  <th scope="col">{d('colSize')}</th>
                  <th scope="col">{d('colNote')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.recent.map((run) => (
                  <tr key={run.id}>
                    <td className={styles.dateCell}>{formatDateTime(run.started_at)}</td>
                    <td>
                      <StatusBadge tone={RUN_TONES[run.status] ?? 'neutral'}>{d(`status.${run.status}`)}</StatusBadge>
                    </td>
                    <td>{formatSize(run.size_bytes)}</td>
                    <td className={styles.mutedCell}>
                      {run.status === 'failed'
                        ? run.error
                        : run.pruned > 0
                          ? d('pruned', { count: run.pruned })
                          : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
