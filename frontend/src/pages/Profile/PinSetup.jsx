// src/pages/Profile/PinSetup.jsx
//
// For a warehouse worker on their profile page who has no PIN yet, or whose
// PIN is locked: the sign-in code an admin gave them, and a new PIN twice.
// One step - the PIN is set and the warehouse opens - instead of signing out,
// signing in with the code form, choosing a PIN and coming back.
//
// The server checks the code belongs to this worker, and checks the PIN
// before spending the code, so a PIN that is too easy does not cost them it.

import { useRef, useState } from 'react';
import { AUTH_ERRORS } from '../../api/auth';
import { useAuth } from '../../auth/useAuth';
import { useLanguage } from '../../i18n/useLanguage';
import styles from './Profile.module.css';

const FOUR_DIGITS = /^\d{4}$/;
const digits = (value) => value.replace(/\D/g, '').slice(0, 4);

/** @param {{ locked: boolean, onOpened: () => void, onCancel: () => void }} props */
export default function PinSetup({ locked, onOpened, onCancel }) {
  const { setupWarehousePin } = useAuth();
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  // A translation key, or the server's own sentence (why a PIN was refused).
  const [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false);
  const pinInput = useRef(null);
  const repeatInput = useRef(null);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;

    // Caught here, so nothing is sent - and no code is spent - on a typo.
    if (!FOUR_DIGITS.test(code)) return setFailure({ key: 'profile.unlock.setup.errors.code' });
    if (!FOUR_DIGITS.test(pin)) return setFailure({ key: 'profile.unlock.errors.pin' });
    if (pin !== repeat) {
      setRepeat('');
      repeatInput.current?.focus();
      return setFailure({ key: 'profile.unlock.setup.errors.mismatch' });
    }

    setBusy(true);
    setFailure(null);
    try {
      await setupWarehousePin({ code, pin });
      onOpened();
    } catch (error) {
      const reason = error?.fields?.pin;
      if (reason) {
        // Too easy to guess: the code was not spent, so only the PIN is cleared.
        setFailure({ text: String(Array.isArray(reason) ? reason[0] : reason) });
        setPin('');
        setRepeat('');
        pinInput.current?.focus();
      } else {
        setFailure({
          key:
            error.code === AUTH_ERRORS.RATE_LIMITED
              ? 'profile.unlock.errors.tooMany'
              : error.code === AUTH_ERRORS.UNAVAILABLE
                ? 'profile.unlock.errors.offline'
                : 'profile.unlock.setup.errors.codeFailed',
        });
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.unlockHelp} role="status">
        {t(locked ? 'profile.unlock.lockedHelp' : 'profile.unlock.noPinHelp')}
      </p>

      {failure && (
        <p className={styles.failure} role="alert">
          {failure.text ?? t(failure.key)}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>{t('profile.unlock.setup.code')}</span>
        <input
          className={`${styles.input} ${styles.pinInput}`}
          type="text"
          name="code"
          value={code}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          autoFocus
          onChange={(event) => {
            const next = digits(event.target.value);
            setCode(next);
            setFailure(null);
            if (next.length === 4) pinInput.current?.focus();
          }}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>{t('profile.unlock.setup.pin')}</span>
        <input
          ref={pinInput}
          className={`${styles.input} ${styles.pinInput}`}
          type="password"
          name="pin"
          value={pin}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-describedby="pin-setup-hint"
          onChange={(event) => {
            const next = digits(event.target.value);
            setPin(next);
            setFailure(null);
            if (next.length === 4) repeatInput.current?.focus();
          }}
        />
      </label>
      {/* Outside the label: inside it, the hint would be read out as part of
          the field's name. Tied to the field as its description instead. */}
      <span className={styles.unlockHint} id="pin-setup-hint">
        {t('profile.unlock.setup.hint')}
      </span>

      <label className={styles.field}>
        <span className={styles.label}>{t('profile.unlock.setup.repeat')}</span>
        <input
          ref={repeatInput}
          className={`${styles.input} ${styles.pinInput}`}
          type="password"
          name="repeat"
          value={repeat}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          onChange={(event) => {
            setRepeat(digits(event.target.value));
            setFailure(null);
          }}
        />
      </label>

      <div className={styles.unlockActions}>
        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? t('profile.unlock.opening') : t('profile.unlock.setup.submit')}
        </button>
        <button type="button" className={styles.unlockCancel} onClick={onCancel}>
          {t('profile.unlock.cancel')}
        </button>
      </div>
    </form>
  );
}
