// src/pages/Profile/TwoFactorCard.jsx
//
// "Two-factor sign-in" on the profile page: a person's own authenticator app.
//
// What it shows depends on the admin's mode (Security page) and this account:
//
//   mode "disabled"           -> nothing at all (the card is not drawn) -
//                                except for an admin, who sets up their own
//                                app here BEFORE switching it on for everyone
//                                (the Security page insists on that order)
//   not turned on             -> "Turn on" (runs the setup on /two-factor)
//   turned on                 -> how many recovery codes are left, and
//                                - "New recovery codes" (needs an app code)
//                                - "Turn off" (needs password AND app code;
//                                  hidden when it is required for this account)
//
// The server checks every one of these again (backend accounts/twofactor_views.py).

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_ERRORS } from '../../api/client';
import { disableTwoFactor, getTwoFactorStatus, newRecoveryCodes } from '../../api/twoFactor';
import { useAuth } from '../../auth/useAuth';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import styles from './Profile.module.css';

export default function TwoFactorCard({ icon }) {
  const { user, refreshUser } = useAuth();
  const { t } = useLanguage();
  const s = (key, values) => fill(t(`profile.twoFactor.${key}`), values);
  const navigate = useNavigate();

  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(null); // null | 'codes' | 'off'
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [freshCodes, setFreshCodes] = useState(null);

  const mode = user?.twoFactorMode ?? 'disabled';

  // "Disabled" on the Security page, but this is an admin: they can set up
  // their own app now, so they can switch it on afterwards.
  const preparing = mode === 'disabled' && Boolean(user?.isAdmin);
  const shown = mode !== 'disabled' || preparing;

  const load = useCallback(() => {
    if (!shown) return;
    getTwoFactorStatus().then(setStatus).catch(() => setStatus(null));
  }, [shown]);
  useEffect(load, [load]);

  if (!shown) return null;

  /** The sentence for a refusal from the server. */
  function failureText(error) {
    if (error?.code === API_ERRORS.RATE_LIMITED) return s('locked');
    if (error?.fields?.code === 'wrong_password') return s('wrongPassword');
    if (error?.code === API_ERRORS.VALIDATION) return s('wrongCode');
    return s('failed');
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (form === 'codes') {
        const answer = await newRecoveryCodes(code.trim());
        setFreshCodes(answer.recovery_codes);
      } else {
        await disableTwoFactor({ password, code: code.trim() });
        setMessage({ ok: true, text: s('turnedOff') });
        await refreshUser();
      }
      setForm(null);
      load();
    } catch (error) {
      setMessage({ ok: false, text: failureText(error) });
    } finally {
      // Never keep a password or code around after a request.
      setCode('');
      setPassword('');
      setBusy(false);
    }
  }

  const enabled = status?.enabled ?? user?.twoFactorEnabled;
  const required = status?.required ?? user?.twoFactorRequired;

  return (
    // twoFactorScope: the page colours, so the card also looks right on the
    // office's own profile page (WarehouseProfile.jsx).
    <section className={`${styles.card} ${styles.twoFactorScope}`} id="two-factor">
      <h2 className={styles.cardTitle}>
        {icon}
        {t('profile.sections.twoFactor')}
      </h2>
      <p className={styles.cardIntro}>{s('intro')}</p>

      {preparing && (
        <p className={styles.cardIntro} role="note">
          {enabled ? s('preparedAdmin') : s('preparingAdmin')}
        </p>
      )}

      <p className={styles.cardIntro}>
        <strong>{enabled ? s('on') : s('off')}</strong>
        {enabled && status && ` · ${s('codesLeft', { count: status.recovery_codes_left })}`}
        {required && ` · ${s('required')}`}
      </p>

      {freshCodes && (
        <div role="status">
          <p className={styles.cardIntro}>{s('freshCodes')}</p>
          <ol style={{ columns: 2, fontFamily: 'monospace', fontSize: '1.05rem' }}>
            {freshCodes.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ol>
          <button type="button" className={styles.linkButton} onClick={() => setFreshCodes(null)}>
            {s('savedThem')}
          </button>
        </div>
      )}

      {!enabled && (
        <button
          type="button"
          className={styles.submit}
          onClick={() => navigate('/two-factor', { state: { enable: true, from: '/profile#two-factor' } })}
        >
          {s('turnOn')}
        </button>
      )}

      {enabled && !form && (
        <div className={styles.row}>
          <button type="button" className={styles.linkButton} onClick={() => setForm('codes')}>
            {s('newCodes')}
          </button>
          {!required && (
            <button type="button" className={styles.linkButton} onClick={() => setForm('off')}>
              {s('turnOff')}
            </button>
          )}
        </div>
      )}

      {form && (
        <form className={styles.form} onSubmit={submit}>
          {form === 'off' && (
            <label className={styles.field}>
              <span className={styles.label}>{s('password')}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <label className={styles.field}>
            <span className={styles.label}>{s('code')}</span>
            <input
              className={styles.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <div className={styles.row}>
            <button
              type="submit"
              className={styles.submit}
              disabled={busy || code.trim().length !== 6 || (form === 'off' && !password)}
            >
              {form === 'off' ? s('turnOffConfirm') : s('newCodesConfirm')}
            </button>
            <button type="button" className={styles.linkButton} onClick={() => setForm(null)}>
              {s('cancel')}
            </button>
          </div>
        </form>
      )}

      {message && (
        <p className={message.ok ? styles.ok : styles.failure} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
