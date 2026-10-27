// src/pages/Login/FloorSignIn.jsx
//
// "Who is working?": the login page on a shared floor device an admin
// registered. Tap your name, type four digits, and you are in - a handover in
// seconds rather than an e-mail address and a code from an admin every time.
//
// Only ever shown when the server recognised the device (its token is in a
// cookie no script can read) and sent the list. Everywhere else the login page
// is the ordinary form, and the list of who works here is not on it.

import { useRef, useState } from 'react';
import { AUTH_ERRORS, getFloorRoster } from '../../api/auth';
import { useAuth } from '../../auth/useAuth';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import styles from './Login.module.css';

const PIN_PATTERN = /^\d{4}$/;

/**
 * @param {{ roster: { device: { name: string }, workers: object[] },
 *           onRoster: (roster: object) => void,
 *           onSignedIn: (profile: object) => void,
 *           onUseCode: () => void, onUsePassword: () => void }} props
 */
export default function FloorSignIn({ roster, onRoster, onSignedIn, onUseCode, onUsePassword }) {
  const { t } = useLanguage();
  const { signInWithPin } = useAuth();
  const [pickedId, setPickedId] = useState(null);
  const [pin, setPin] = useState('');
  const [failureKey, setFailureKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  // Looked up in the latest list rather than kept as a copy, so a PIN that
  // locked on the last try shows as locked straight away.
  const picked = roster.workers.find((worker) => worker.id === pickedId) ?? null;

  function pick(worker) {
    setPickedId(worker?.id ?? null);
    setPin('');
    setFailureKey(null);
  }

  async function send(value) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailureKey(null);

    try {
      onSignedIn(await signInWithPin({ worker: picked.id, pin: value }));
    } catch (error) {
      setFailureKey(
        error.code === AUTH_ERRORS.RATE_LIMITED
          ? 'login.floor.errors.coolingOff'
          : error.code === AUTH_ERRORS.UNAVAILABLE
            ? 'login.errors.offline'
            : 'login.floor.errors.failed',
      );
      // Never keep a secret around after a failed attempt.
      setPin('');
      // The try may have locked it: ask again, so the screen says so.
      getFloorRoster().then(onRoster, () => {});
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function handlePin(event) {
    const next = event.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(next);
    setFailureKey(null);
    // The fourth digit is the end of it, as with the e-mailed code.
    if (PIN_PATTERN.test(next)) send(next);
  }

  const otherWays = (
    <div className={styles.floorLinks}>
      <button type="button" className={styles.floorLink} onClick={onUseCode}>
        {t('login.floor.useCode')}
      </button>
      <button type="button" className={styles.floorLink} onClick={onUsePassword}>
        {t('login.floor.usePassword')}
      </button>
    </div>
  );

  if (!picked) {
    return (
      <>
        <p className={styles.floorDevice}>
          {fill(t('login.floor.device'), { name: roster.device.name })}
        </p>
        {roster.workers.length === 0 ? (
          <p className={styles.hint}>{t('login.floor.noWorkers')}</p>
        ) : (
          <ul className={styles.roster} aria-label={t('login.floor.title')}>
            {roster.workers.map((worker) => (
              <li key={worker.id}>
                <button
                  type="button"
                  className={styles.rosterButton}
                  onClick={() => pick(worker)}
                >
                  <span className={styles.rosterName}>{worker.name}</span>{' '}
                  {(worker.locked || !worker.has_pin) && (
                    <span className={styles.rosterNote}>
                      {t(worker.locked ? 'login.floor.locked' : 'login.floor.noPin')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {otherWays}
      </>
    );
  }

  // A locked PIN, or none yet: the way forward is an e-mailed code, which is
  // also how a PIN is set or replaced.
  const help = picked.locked
    ? 'login.floor.lockedHelp'
    : !picked.has_pin
      ? 'login.floor.noPinHelp'
      : null;

  return (
    <>
      <button type="button" className={styles.floorLink} onClick={() => pick(null)}>
        {t('login.floor.notYou')}
      </button>

      {failureKey && (
        <p className={styles.failure} role="alert">
          {t(failureKey)}
        </p>
      )}

      {help ? (
        <>
          <h2 className={styles.floorName}>{picked.name}</h2>
          <p className={styles.floorHelp} role="status">
            {t(help)}
          </p>
          <button type="button" className={styles.submit} onClick={onUseCode}>
            {t('login.floor.useCode')}
          </button>
        </>
      ) : (
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (PIN_PATTERN.test(pin)) send(pin);
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="floor-pin">
              {fill(t('login.floor.pinFor'), { name: picked.name })}
            </label>
            <input
              id="floor-pin"
              className={`${styles.input} ${styles.codeInput}`}
              // Dots, not digits: the next person in the queue is standing
              // right behind whoever is typing.
              type="password"
              name="pin"
              value={pin}
              onChange={handlePin}
              inputMode="numeric"
              pattern="[0-9]*"
              // Never offered for saving: a shared device's password manager
              // would hand one worker's PIN to the next.
              autoComplete="off"
              autoFocus
              aria-describedby="floor-pin-hint"
            />
            <span className={styles.hint} id="floor-pin-hint">
              {t('login.floor.pinHint')}
            </span>
          </div>
          <button type="submit" className={styles.submit} disabled={busy || !PIN_PATTERN.test(pin)}>
            {busy ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      )}
    </>
  );
}
