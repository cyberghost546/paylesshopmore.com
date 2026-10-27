// src/pages/Dashboard/WarehouseAccess.jsx
//
// "Warehouse access": what warehouse workers may see and use in the
// warehouse app. One switch per part, for all warehouse workers at once.
// Only an admin may change them; other office staff see them read-only.
//
// The office and admins themselves are never limited. A switched-off part
// is left out of the warehouse app AND refused by the server (backend
// warehouse/access.py), so it cannot be reached by typing its address.
// Scanning, the package list and the package page are always on: without
// them the floor cannot work.
//
// The list of switches and their wording come from the server
// (WarehouseAccess.SECTIONS in backend warehouse/models.py), so a new switch
// added there shows up here by itself.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/warehouse-access
//   Who can open: office staff (admins change it)
//   Links to:     nothing
//   Linked from:  the dashboard sidebar
//   Backend:      api/warehouse.js

import { useEffect, useState } from 'react';
import { getWarehouseAccess, saveWarehouseAccess } from '../../api/warehouse';
import { useAuth } from '../../auth/useAuth';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { formatDateTime } from './format';
import { Banner } from './ui';
import styles from './Dashboard.module.css';
import { canManageWarehouse } from './managerAccess';
import { labelFor, usePageText } from './usePageText';

export default function WarehouseAccess() {
  const { user } = useAuth();
  const d = usePageText('warehouseAccess');
  const c = usePageText('common');
  // Admins and warehouse managers set the switches.
  const isAdmin = canManageWarehouse(user);

  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let live = true;
    getWarehouseAccess()
      .then((access) => {
        if (!live) return;
        setSaved(access);
        setDraft(access.sections);
        setState('ready');
      })
      .catch(() => {
        if (live) setState('error');
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  if (state === 'loading') return <Loading inline />;
  if (state === 'error') {
    return (
      <ConnectionError
        inline
        onRetry={() => {
          setState('loading');
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  const dirty = saved.choices.some(({ key }) => draft[key] !== saved.sections[key]);
  const offCount = saved.choices.filter(({ key }) => !draft[key]).length;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const access = await saveWarehouseAccess(draft);
      setSaved(access);
      setDraft(access.sections);
      setMessage({ tone: 'success', text: d('saved') });
    } catch {
      setMessage({ tone: 'error', text: d('saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* data-tour hooks: this page's tour ("dashboardWarehouseAccess" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-access-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      {!isAdmin && (
        <Banner tone="info">{d('onlyAdmin')}</Banner>
      )}
      <Banner tone={message?.tone}>{message?.text}</Banner>

      <section className={styles.accessCard} data-tour="db-access-switches">
        <div className={styles.accessHead}>
          <p className={styles.accessCount}>
            {offCount === 0
              ? d('allOn')
              : offCount === 1
                ? d('oneOff')
                : d('someOff', { count: offCount })}
          </p>
          {saved.updated_at && (
            <p className={styles.accessWhen}>{d('lastChanged', { when: formatDateTime(saved.updated_at) })}</p>
          )}
        </div>

        <ul className={styles.accessList}>
          {saved.choices.map(({ key, title, description }) => {
            const on = Boolean(draft[key]);
            const id = `access-${key}`;
            return (
              <li key={key} className={styles.accessRow}>
                <label htmlFor={id} className={styles.accessText}>
                  <span className={styles.accessTitle}>{labelFor(d, 'section', key, title)}</span>
                  <span className={styles.accessDescription}>{labelFor(d, 'about', key, description)}</span>
                </label>
                {/* A switch: a checkbox styled as a slider, so it still works
                    with the keyboard and a screen reader. */}
                <span className={styles.switch}>
                  <input
                    id={id}
                    type="checkbox"
                    role="switch"
                    checked={on}
                    disabled={!isAdmin || busy}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [key]: event.target.checked }))
                    }
                  />
                  <span className={styles.switchTrack} aria-hidden="true" />
                </span>
                <span className={on ? styles.accessOn : styles.accessOff}>{on ? d('on') : d('off')}</span>
              </li>
            );
          })}
        </ul>

        {isAdmin && (
          <div className={styles.accessActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!dirty || busy}
              onClick={save}
            >
              {busy ? c('saving') : d('save')}
            </button>
            {dirty && (
              <button
                type="button"
                className={styles.linkButton}
                disabled={busy}
                onClick={() => setDraft(saved.sections)}
              >
                {d('undo')}
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
