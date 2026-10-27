// src/pages/TwoFactor/TwoFactorPage.jsx
//
// The second step of signing in: the 6-digit code from an authenticator app
// (Google Authenticator, Microsoft Authenticator, ...). Whether anybody is
// asked at all is the admin's choice on the dashboard's Security page; how it
// works on the server: backend accounts/twofactor.py.
//
// READ THIS FIRST - the page shows one of three things, picked from
// user.twoFactor (sent by the server with the profile):
//
//   "code_required"   turned on      -> "Enter the code from your app"
//   "setup_required"  required, but  -> 1. scan the QR code
//                     not set up yet    2. type the first code
//                                       3. save the 10 recovery codes
//   anything else     nothing to do  -> straight on to where they were going
//
// It also runs the same setup when somebody turns two-factor on themselves
// from their profile (state.enable, while the admin has it "optional").
//
// The guards (RequireStaff, RequireAuth, RequireWarehouse) send people here
// while their session still owes the code. Until then the server refuses
// almost everything, so this page is not a formality.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /two-factor
//   Who can open: anybody signed in
//   Links to:     where they were going (state.from), or /dashboard
//   Linked from:  the guards above, right after signing in; the profile's
//                 "Two-factor sign-in" card
//   Backend:      api/twoFactor.js

import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { API_ERRORS } from '../../api/client';
import { confirmTwoFactor, startTwoFactorSetup, verifyTwoFactor } from '../../api/twoFactor';
import { useAuth } from '../../auth/useAuth';
import Loading from '../../components/Loading/Loading';
import { useLanguage } from '../../i18n/useLanguage';
import styles from '../Login/Login.module.css';

const NEEDS_CODE = ['code_required', 'setup_required'];

/** "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP": easier to type into a phone. */
function grouped(secret) {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** The sentence for a refused code: wrong, or too many wrong. */
function codeError(error, t) {
  if (error?.code === API_ERRORS.RATE_LIMITED) return t('twoFactor.locked');
  if (error?.code === API_ERRORS.VALIDATION) return t('twoFactor.wrongCode');
  return t('twoFactor.offline');
}

/** The QR code an authenticator app scans. Drawn by @zxing, loaded only here. */
function QrCode({ text, label }) {
  const box = useRef(null);
  useEffect(() => {
    let live = true;
    const target = box.current;
    import('@zxing/browser').then(({ BrowserQRCodeSvgWriter }) => {
      if (!live || !target) return;
      const svg = new BrowserQRCodeSvgWriter().write(text, 200, 200);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
      target.replaceChildren(svg);
    });
    return () => {
      live = false;
    };
  }, [text, label]);
  return <div ref={box} style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0' }} />;
}

/** The code box, used in both modes. */
function CodeForm({ label, hint, busy, error, onSubmit, submitLabel, t, allowBackup }) {
  const [code, setCode] = useState('');
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(code.trim());
      }}
      noValidate
    >
      {error && (
        <p className={styles.failure} role="alert">
          {error}
        </p>
      )}
      <label className={styles.field}>
        <span className={styles.label}>{label}</span>
        <input
          className={`${styles.input} ${styles.codeInput}`}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          // A recovery code has letters, so only the app-code form is digits-only.
          inputMode={allowBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          maxLength={allowBackup ? 16 : 6}
        />
        <span className={styles.hint}>{hint}</span>
      </label>
      <button type="submit" className={styles.submit} disabled={busy || code.trim().length < 6}>
        {busy ? t('twoFactor.checking') : submitLabel}
      </button>
    </form>
  );
}

export default function TwoFactorPage() {
  const { user, isChecking, refreshUser, signOut } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  // Turning it on from the profile: the same setup, then back to the profile.
  const enabling = Boolean(location.state?.enable) && user?.twoFactor === 'off';
  const goingTo = location.state?.from ?? (enabling ? '/profile#two-factor' : '/dashboard');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Setup only: the secret from the server, and afterwards the recovery codes.
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [saved, setSaved] = useState(false);

  const mode = enabling ? 'setup_required' : user?.twoFactor;

  // First time: ask the server for a secret as soon as the page opens.
  useEffect(() => {
    if (mode !== 'setup_required' || setup || recoveryCodes) return undefined;
    let live = true;
    startTwoFactorSetup()
      .then((answer) => live && setSetup(answer))
      .catch(() => {
        // 409: set up meanwhile (another tab). Reading the profile again moves
        // this page on to the code form.
        if (live) refreshUser().catch(() => setError(t('twoFactor.offline')));
      });
    return () => {
      live = false;
    };
  }, [mode, setup, recoveryCodes, refreshUser, t]);

  if (isChecking) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!NEEDS_CODE.includes(mode) && !recoveryCodes) return <Navigate to={goingTo} replace />;

  async function finish() {
    await refreshUser();
    navigate(goingTo, { replace: true });
  }

  async function verify(code) {
    setBusy(true);
    setError('');
    try {
      await verifyTwoFactor(code);
      await finish();
    } catch (failure) {
      setError(codeError(failure, t));
      setBusy(false);
    }
  }

  async function confirm(code) {
    setBusy(true);
    setError('');
    try {
      const answer = await confirmTwoFactor(code);
      setRecoveryCodes(answer.recovery_codes);
    } catch (failure) {
      setError(codeError(failure, t));
    } finally {
      setBusy(false);
    }
  }

  function downloadCodes() {
    const text = `${t('twoFactor.codesFileTitle')}\n${user.email}\n\n${recoveryCodes.join('\n')}\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = 'paylesshopmore-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  let body;
  if (recoveryCodes) {
    // ---- setup, step 3: the recovery codes, shown once ----
    body = (
      <>
        <h1 className={styles.title}>{t('twoFactor.codesTitle')}</h1>
        <p className={styles.subtitle}>{t('twoFactor.codesIntro')}</p>
        <ol style={{ columns: 2, fontFamily: 'monospace', fontSize: '1.05rem', margin: '0 0 1rem' }}>
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <button type="button" className={styles.footerLink} onClick={downloadCodes}>
          {t('twoFactor.download')}
        </button>
        <label className={styles.remember} style={{ margin: '1rem 0' }}>
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>{t('twoFactor.savedThem')}</span>
        </label>
        <button type="button" className={styles.submit} disabled={!saved} onClick={finish}>
          {t('twoFactor.continue')}
        </button>
      </>
    );
  } else if (mode === 'setup_required') {
    // ---- setup, steps 1 and 2 ----
    body = (
      <>
        <h1 className={styles.title}>{t('twoFactor.setupTitle')}</h1>
        <p className={styles.subtitle}>{t('twoFactor.setupIntro')}</p>
        {!setup ? (
          error ? <p className={styles.failure} role="alert">{error}</p> : <Loading inline />
        ) : (
          <>
            <p className={styles.label}>{t('twoFactor.step1')}</p>
            <QrCode text={setup.otpauth_uri} label={t('twoFactor.qrLabel')} />
            <p className={styles.hint}>
              {t('twoFactor.cannotScan')} <code style={{ fontSize: '1rem' }}>{grouped(setup.secret)}</code>
            </p>
            <p className={styles.label} style={{ marginTop: '1.25rem' }}>{t('twoFactor.step2')}</p>
            <CodeForm
              label={t('twoFactor.codeLabel')}
              hint={t('twoFactor.codeHint')}
              busy={busy}
              error={error}
              onSubmit={confirm}
              submitLabel={t('twoFactor.finishSetup')}
              t={t}
            />
          </>
        )}
      </>
    );
  } else {
    // ---- every sign-in after that ----
    body = (
      <>
        <h1 className={styles.title}>{t('twoFactor.codeTitle')}</h1>
        <p className={styles.subtitle}>{t('twoFactor.codeIntro')}</p>
        <CodeForm
          label={t('twoFactor.codeLabel')}
          hint={t('twoFactor.backupHint')}
          busy={busy}
          error={error}
          onSubmit={verify}
          submitLabel={t('twoFactor.verify')}
          t={t}
          allowBackup
        />
      </>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {body}
        <p className={styles.footer}>
          <button type="button" className={styles.footerLink} onClick={() => signOut()}>
            {t('twoFactor.signOut')}
          </button>
        </p>
      </div>
    </div>
  );
}
