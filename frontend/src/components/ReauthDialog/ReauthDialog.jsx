// src/components/ReauthDialog/ReauthDialog.jsx
//
// The "Confirm it's you" box, shown before a sensitive admin action when the
// password has not been typed in the last few minutes.
//
// READ THIS FIRST - how it is used:
//   Pages do NOT open this themselves. api/client.js notices the server's
//   403 {"code": "reauth_required"}, calls the handler registered below, waits
//   for the person, and then repeats the original request on its own. So
//   "Change role" or "New API key" just work - with one extra box in between
//   when it has been a while. (Backend: accounts/reauth.py.)
//
// It asks for the password, plus the 6-digit authenticator code when the
// server says this person uses two-factor (needsCode).

import { useCallback, useEffect, useRef, useState } from 'react';
import { reauthenticate } from '../../api/auth';
import { API_ERRORS, setReauthHandler } from '../../api/client';
import { useLanguage } from '../../i18n/useLanguage';
import styles from '../../pages/Login/Login.module.css';

export default function ReauthDialog() {
  const { t } = useLanguage();
  // While open: { needsCode, resolve, reject } from the waiting request.
  const [pending, setPending] = useState(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  // Register once: api/client.js calls this and waits on the promise.
  useEffect(() => {
    setReauthHandler(
      ({ needsCode }) =>
        new Promise((resolve, reject) => {
          setPending({ needsCode, resolve, reject });
        }),
    );
    return () => setReauthHandler(null);
  }, []);

  const close = useCallback(
    (confirmed) => {
      if (!pending) return;
      if (confirmed) pending.resolve();
      else pending.reject(new Error('cancelled'));
      setPending(null);
      // Never keep a password or code around.
      setPassword('');
      setCode('');
      setError('');
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return undefined;
    input.current?.focus();
    const onKey = (event) => event.key === 'Escape' && close(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  if (!pending) return null;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await reauthenticate({ password, code: code.trim() });
      close(true);
    } catch (failure) {
      if (failure?.code === API_ERRORS.RATE_LIMITED) setError(t('reauth.locked'));
      else if (failure?.fields?.code) setError(t('reauth.wrongCode'));
      else if (failure?.code === API_ERRORS.VALIDATION) setError(t('reauth.wrongPassword'));
      else setError(t('reauth.failed'));
      setPassword('');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '1rem', background: 'rgba(15, 23, 42, 0.45)',
      }}
    >
      <form
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        onSubmit={submit}
        noValidate
      >
        <h2 className={styles.title} id="reauth-title">{t('reauth.title')}</h2>
        <p className={styles.subtitle}>{t('reauth.intro')}</p>
        {error && <p className={styles.failure} role="alert">{error}</p>}
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>{t('reauth.password')}</span>
            <input
              ref={input}
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {pending.needsCode && (
            <label className={styles.field}>
              <span className={styles.label}>{t('reauth.code')}</span>
              <input
                className={`${styles.input} ${styles.codeInput}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
          <button
            type="submit"
            className={styles.submit}
            disabled={busy || !password || (pending.needsCode && code.trim().length !== 6)}
          >
            {busy ? t('reauth.checking') : t('reauth.confirm')}
          </button>
          <button type="button" className={styles.footerLink} onClick={() => close(false)}>
            {t('reauth.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
