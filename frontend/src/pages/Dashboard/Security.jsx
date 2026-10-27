// src/pages/Dashboard/Security.jsx
//
// "Security": the admin decides how strict two-factor sign-in (an
// authenticator app on the phone) is for the whole site. Admins only - the
// server refuses everybody else (backend staff/security.py).
//
// READ THIS FIRST - the four modes (backend accounts/twofactor.py):
//
//   disabled         nobody is asked; signing in works exactly as before.
//                    The default, so development is never blocked.
//   optional         people may turn it on from their profile.
//   required_admins  every administrator must use it.
//   required_all     everybody who signs in with a password must use it.
//
// How a change is made safely:
//   1. pick a mode -> "Save changes"
//   2. a confirmation dialog says what will happen and to whom, and asks for
//      the admin's own password again
//   3. the server checks again, refuses a change that would lock out the
//      admin making it (they must have it set up themselves first), saves
//      the mode in the database and writes it to the audit list below.
//
// The status box shows the mode actually ENFORCED. That can be stricter than
// the one chosen here: the server's environment may set a minimum
// (DJANGO_TWO_FACTOR_MINIMUM_MODE) that this page cannot go below.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/security
//   Who can open: admins (other office staff see a note)
//   Links to:     /profile#two-factor (to set it up on your own account)
//   Linked from:  the dashboard sidebar
//   Backend:      api/twoFactor.js -> backend staff/security.py

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTwoFactorPolicy, setTwoFactorPolicy } from '../../api/twoFactor';
import { useAuth } from '../../auth/useAuth';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { formatDateTime } from './format';
import { Banner, Empty, StatusBadge } from './ui';
import { usePageText } from './usePageText';
import styles from './Dashboard.module.css';

// From least to most strict, as the server orders them.
const MODES = ['disabled', 'optional', 'required_admins', 'required_all'];
const MODE_TONE = { disabled: 'off', optional: 'neutral', required_admins: 'done', required_all: 'done' };

/**
 * The confirmation before a mode is saved: what changes, for whom, and the
 * admin's password (the server checks it). Esc or Cancel closes it.
 */
function ConfirmDialog({ d, from, to, data, busy, error, onConfirm, onCancel }) {
  const [password, setPassword] = useState('');
  const input = useRef(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (event) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const affected = data.affected?.[to];
  const without = affected ? affected.total - affected.set_up : 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '1rem', background: 'rgba(15, 23, 42, 0.45)',
      }}
    >
      <form
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-confirm-title"
        style={{ maxWidth: '34rem', width: '100%', margin: 0 }}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(password);
        }}
      >
        <h2 className={styles.modalTitle} id="security-confirm-title">{d('confirmTitle')}</h2>
        <p className={styles.modalIntro}>
          {d('confirmChange', { from: d(`mode.${from}.label`), to: d(`mode.${to}.label`) })}
        </p>
        <p className={styles.modalNote}>{d(`mode.${to}.effect`)}</p>
        {affected && without > 0 && (
          <div className={styles.modalWarning}>
            <p className={styles.modalWarningTitle}>{d('confirmWithout', { count: without, total: affected.total })}</p>
            <p>{d('confirmWithoutNote')}</p>
            {affected.without.length > 0 && (
              <ul style={{ margin: 0 }}>
                {affected.without.map((who) => (
                  <li key={who.id}>{who.name} ({who.email})</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <label className={styles.officeField} style={{ marginTop: '1rem' }}>
          <span className={styles.officeLabel}>{d('yourPassword')}</span>
          <input
            ref={input}
            className={styles.officeInput}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className={styles.modalError} role="alert">{error}</p>}
        <div className={styles.modalActions}>
          <button type="submit" className={styles.primaryButton} disabled={busy || !password}>
            {busy ? d('saving') : d('confirmSave')}
          </button>
          <button type="button" className={styles.linkButton} onClick={onCancel}>{d('cancel')}</button>
        </div>
      </form>
    </div>
  );
}

export default function Security() {
  const { user, refreshUser } = useAuth();
  const d = usePageText('security');
  const isAdmin = Boolean(user?.isAdmin);

  const [state, setState] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [chosen, setChosen] = useState('disabled');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!isAdmin) return undefined;
    let live = true;
    getTwoFactorPolicy()
      .then((answer) => {
        if (!live) return;
        setData(answer);
        setChosen(answer.mode);
        setState('ready');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [isAdmin, attempt]);

  if (!isAdmin) {
    return (
      <>
        <header className={styles.head}>
          <h1 className={styles.title}>{d('title')}</h1>
        </header>
        <Banner tone="info">{d('adminOnly')}</Banner>
      </>
    );
  }
  if (state === 'loading') return <Loading inline />;
  if (state === 'error') return <ConnectionError inline onRetry={() => { setState('loading'); setAttempt((n) => n + 1); }} />;

  const needsYourOwn = (chosen === 'required_admins' || chosen === 'required_all') && !data.you_have_it;
  const unchanged = chosen === data.mode;

  async function save(password) {
    setBusy(true);
    setDialogError('');
    try {
      const answer = await setTwoFactorPolicy({ mode: chosen, password });
      setData(answer);
      setChosen(answer.mode);
      setConfirming(false);
      setMessage({ tone: 'success', text: d('saved', { mode: d(`mode.${answer.mode}.label`) }) });
      // Your own session may now owe a code (or be free of one).
      refreshUser().catch(() => {});
    } catch (failure) {
      const fields = failure?.fields ?? {};
      if (fields.password) setDialogError(d('wrongPassword'));
      else if (fields.code === 'would_lock_you_out') setDialogError(d('setUpYoursFirst'));
      else setDialogError(d('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Banner tone={message?.tone}>{message?.text}</Banner>

      {/* ---- the status indicator: what is enforced right now ---- */}
      <section className={styles.officeBox} aria-label={d('statusTitle')}>
        <p className={styles.officeHead}>
          {d('statusTitle')}{' '}
          <StatusBadge tone={MODE_TONE[data.effective_mode]}>{d(`mode.${data.effective_mode}.label`)}</StatusBadge>
        </p>
        <p className={styles.officeNote}>{d(`mode.${data.effective_mode}.effect`)}</p>
        {data.minimum_mode !== 'disabled' && (
          <p className={styles.officeNote}>{d('minimumNote', { mode: d(`mode.${data.minimum_mode}.label`) })}</p>
        )}
        {data.force_disabled && <p className={styles.officeNote}>{d('forceDisabledNote')}</p>}
        <p className={styles.officeNote}>
          {data.you_have_it ? d('youHaveIt') : d('youDoNot')}{' '}
          <Link className={styles.link} to="/profile#two-factor">{d('yourSettings')}</Link>
        </p>
      </section>

      {/* ---- choosing the mode ---- */}
      <h2 className={`${styles.detailTitle} ${styles.floorSection}`}>{d('chooseTitle')}</h2>
      <fieldset className={styles.floorSections}>
        <legend className={styles.srOnly}>{d('chooseTitle')}</legend>
        {MODES.map((mode) => {
          const affected = data.affected?.[mode];
          return (
            <label key={mode} className={styles.floorCheck}>
              <input type="radio" name="mode" value={mode} checked={chosen === mode} onChange={() => setChosen(mode)} />
              <span>
                <span className={styles.accessTitle}>
                  {d(`mode.${mode}.label`)}
                  {mode === data.mode && ` — ${d('current')}`}
                </span>
                <span className={styles.accessDescription}>{d(`mode.${mode}.effect`)}</span>
                {affected && (
                  <span className={styles.accessDescription}>
                    {d(mode === 'required_admins' ? 'countAdmins' : 'countEveryone', {
                      set_up: affected.set_up,
                      total: affected.total,
                    })}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      {needsYourOwn && (
        <Banner tone="error">
          {d('setUpYoursFirst')}{' '}
          <Link className={styles.link} to="/profile#two-factor">{d('yourSettings')}</Link>
        </Banner>
      )}

      <div className={styles.floorActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={unchanged || needsYourOwn}
          onClick={() => {
            setDialogError('');
            setConfirming(true);
          }}
        >
          {d('save')}
        </button>
      </div>

      {confirming && (
        <ConfirmDialog
          d={d}
          from={data.mode}
          to={chosen}
          data={data}
          busy={busy}
          error={dialogError}
          onConfirm={save}
          onCancel={() => setConfirming(false)}
        />
      )}

      {/* ---- the audit trail ---- */}
      <h2 className={`${styles.detailTitle} ${styles.floorSection}`}>{d('auditTitle')}</h2>
      <p className={styles.officeNote}>{d('auditNote')}</p>
      {data.events.length === 0 ? (
        <Empty>{d('noEvents')}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{d('colWhen')}</th>
                <th scope="col">{d('colWhat')}</th>
                <th scope="col">{d('colAccount')}</th>
                <th scope="col">{d('colBy')}</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id}>
                  <td className={styles.dateCell}>{formatDateTime(event.created_at)}</td>
                  <td>
                    {d(`event.${event.kind}`)}
                    {event.kind === 'policy_changed' && (
                      <div className={styles.mutedCell}>
                        {d(`mode.${event.detail.from}.label`)} → {d(`mode.${event.detail.to}.label`)}
                      </div>
                    )}
                  </td>
                  <td>{event.user ? event.user.name : '—'}</td>
                  <td className={styles.mutedCell}>{event.actor ? event.actor.name : d('server')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
