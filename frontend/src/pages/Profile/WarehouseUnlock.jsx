// src/pages/Profile/WarehouseUnlock.jsx
//
// "Go to the warehouse", for a warehouse worker who signed in with a password
// like a customer. A password opens this profile page and nothing more; their
// own e-mail address and their PIN open the warehouse - on the floor's terms,
// with the short idle timeout of any floor session. The server enforces it
// (staff.permissions.IsWarehouseOrStaff); this is the form.

import { useEffect, useRef, useState } from 'react';
import { AUTH_ERRORS } from '../../api/auth';
import { useAuth } from '../../auth/useAuth';
import { useLanguage } from '../../i18n/useLanguage';
import PinSetup from './PinSetup';
import styles from './Profile.module.css';

const PIN_PATTERN = /^\d{4}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** @param {{ onOpened: () => void, onCancel: () => void }} props */
export default function WarehouseUnlock({ onOpened, onCancel }) {
  const { user, unlockWarehouse } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [failureKey, setFailureKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const pinInput = useRef(null);

  // The help robot is put away while this form is open: on a phone it sat on
  // the e-mail field. The same switch a floor device's login page uses
  // (PageGuide.module.css).
  useEffect(() => {
    document.documentElement.dataset.floorDevice = 'true';
    return () => {
      delete document.documentElement.dataset.floorDevice;
    };
  }, []);

  // No PIN yet, or locked after too many wrong tries: a sign-in code from an
  // admin sets a new one, right here (PinSetup).
  const needsPin = Boolean(user?.pinLocked || !user?.hasPin);

  async function send(values) {
    if (sending.current) return;
    if (!EMAIL_PATTERN.test(values.email.trim())) {
      setFailureKey('profile.unlock.errors.email');
      return;
    }
    if (!PIN_PATTERN.test(values.pin)) {
      setFailureKey('profile.unlock.errors.pin');
      return;
    }

    sending.current = true;
    setBusy(true);
    setFailureKey(null);
    try {
      await unlockWarehouse({ email: values.email.trim(), pin: values.pin });
      onOpened();
    } catch (error) {
      setFailureKey(
        error.code === AUTH_ERRORS.RATE_LIMITED
          ? 'profile.unlock.errors.tooMany'
          : error.code === AUTH_ERRORS.UNAVAILABLE
            ? 'profile.unlock.errors.offline'
            : 'profile.unlock.errors.failed',
      );
      // Never keep a secret around after a failed attempt.
      setPin('');
      pinInput.current?.focus();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="warehouse-unlock-title">
      <h2 className={styles.cardTitle} id="warehouse-unlock-title">
        {t('profile.unlock.title')}
      </h2>

      {needsPin ? (
        <PinSetup locked={Boolean(user?.pinLocked)} onOpened={onOpened} onCancel={onCancel} />
      ) : (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            send({ email, pin });
          }}
        >
          <p className={styles.unlockIntro}>{t('profile.unlock.intro')}</p>

          {failureKey && (
            <p className={styles.failure} role="alert">
              {t(failureKey)}
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.label}>{t('profile.unlock.email')}</span>
            <input
              className={styles.input}
              type="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !PIN_PATTERN.test(pin)) {
                  event.preventDefault();
                  pinInput.current?.focus();
                }
              }}
              // A shared device's list of addresses typed here before is a
              // list of colleagues.
              autoComplete="off"
              enterKeyHint="next"
              autoFocus
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('profile.unlock.pin')}</span>
            <input
              ref={pinInput}
              className={`${styles.input} ${styles.pinInput}`}
              // Dots: somebody may be standing behind them.
              type="password"
              name="pin"
              value={pin}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, '').slice(0, 4);
                setPin(next);
                setFailureKey(null);
                // The fourth digit is the end of it, once the address looks right.
                if (PIN_PATTERN.test(next) && EMAIL_PATTERN.test(email.trim())) {
                  send({ email, pin: next });
                }
              }}
            />
          </label>

          <div className={styles.unlockActions}>
            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? t('profile.unlock.opening') : t('profile.unlock.submit')}
            </button>
            <button type="button" className={styles.unlockCancel} onClick={onCancel}>
              {t('profile.unlock.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
