// src/pages/Dashboard/Scan.jsx
//
// The warehouse scanner: point a phone at the code on a box, and get either
// the intake sheet somebody already wrote for it or a way to start one.
//
// This page is designed for a phone held in one hand in a warehouse, which is
// a different thing from a page that merely fits on a phone. Everything it
// asks for is one tap, the targets are large, and the answer to a scan is a
// single card with a single button on it. There is no table.
//
// Three things it refuses to do:
//
// * Decide for you. A scan looks the code up and stops. Starting a sheet is a
//   second, deliberate tap, because the commonest failure of a scanner is the
//   mis-scan - the label on the box behind, the second barcode on a carton -
//   and one that wrote a row on every read would fill the dashboard with junk
//   somebody has to work out and delete.
// * Insist on the camera. There is a box to type into, and it is not hidden
//   away: labels get torn, get wet, get covered in tape, and a scanner that
//   is the only way in is one that stops the work when it fails.
// * Load the camera library until it is needed. It is large, and somebody who
//   opens this page to type a number should not wait for it.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /warehouse/scan  (and /dashboard/scan, which redirects here)
//   Who can open: warehouse workers and office staff
//   Links to:     /warehouse/packages/:id (a package code), /warehouse/intake (a booking code)
//   Linked from:  the warehouse menu, Warehouse home, Package page ("Next package"), the dashboard
//                 sidebar, Warehouse profile
//   Backend:      api/staff.js, api/warehouse.js

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmCourierArrival, createIntakeSheet, scanCode } from '../../api/staff';
import { recordScan } from '../../api/warehouse';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { Banner, StatusBadge } from './ui';
import styles from './Dashboard.module.css';

/**
 * A touch device - a tablet or phone, where the camera is the scanner. On a
 * warehouse PC the scanner is usually a handheld gun that types the code and
 * presses Enter, so there the text box gets the focus instead.
 */
function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

/**
 * Whether the browser will give us a camera at all.
 *
 * getUserMedia is only exposed on a secure origin, so on plain http the
 * property is simply missing rather than the call failing - which reads as
 * "this phone has no camera" unless it is checked for separately. localhost
 * counts as secure, which is what makes this testable in development.
 */
function cameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/** The camera, as a hook: start it, stop it, and hear about a decoded code. */
function useScanner(onCode) {
  const videoRef = useRef(null);
  // The zxing controls object, which is the only handle on the camera track.
  // A ref rather than state: losing it leaks a camera that stays switched on
  // behind the page, and a re-render must not be able to drop it.
  const controlsRef = useRef(null);

  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setRunning(false);
  }, []);

  // Stopped on the way out, always. A camera left running is a light on the
  // phone, a flat battery and, to anybody watching, a page that is still
  // looking at them.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setError('');

    if (!cameraAvailable()) {
      setError(
        window.isSecureContext === false ? 'cameraHttps' : 'cameraNone',
      );
      return;
    }

    setStarting(true);

    try {
      // Loaded here rather than imported at the top of the file, so the
      // decoder is downloaded the first time somebody actually scans and
      // never for somebody who came here to type.
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();

      controlsRef.current = await reader.decodeFromConstraints(
        // The back camera. `ideal` rather than `exact` so a laptop with only
        // a front camera still works instead of failing outright.
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (result) => {
          if (!result) return;

          // One code per start. zxing keeps decoding the same label many
          // times a second, and without this a box held in front of the lens
          // would fire a lookup on every frame.
          stop();
          onCode(result.getText());
        },
      );

      setRunning(true);
    } catch (failure) {
      setError(
        failure?.name === 'NotAllowedError' ? 'cameraBlocked' : 'cameraFailed',
      );
    } finally {
      setStarting(false);
    }
  }, [onCode, stop]);

  return { videoRef, start, stop, running, starting, error };
}

/**
 * A courier's barcode (PostNL, DHL ...) that a customer entered on their order:
 * whose parcel this is, and one tap to record that it has arrived.
 *
 * Shown above the usual card. The server matched the whole number exactly and
 * only when exactly one order has it - a partial match or a name never gets
 * here - so the customer shown is the right one. Confirming twice is harmless:
 * the server records the arrival once and says when it was.
 */
function CourierParcel({ code, courier, onOpenShipment }) {
  const { t, language } = useLanguage();
  const s = (key, values) => fill(t(`dashboard.flow.scan.${key}`), values);
  const [current, setCurrent] = useState(courier);
  const [busy, setBusy] = useState(false);
  // { tone, text } after a tap.
  const [message, setMessage] = useState(null);

  const when = (value) =>
    value
      ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
      : '';

  async function confirm() {
    setBusy(true);
    try {
      const answer = await confirmCourierArrival(code);
      setCurrent(answer.courier);
      setMessage(
        answer.already
          ? {
              tone: 'info',
              text: s('alreadyArrived', {
                when: when(answer.courier.arrived_at),
                name: answer.courier.arrived_by ?? '—',
              }),
            }
          : { tone: 'success', text: s('arrived') },
      );
    } catch {
      setMessage({ tone: 'error', text: s('arrivalFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.scanResult}>
      <p className={styles.scanResultHead}>{s('courierHead')}</p>
      <p className={styles.scanCode}>
        {s('courierNumber', { carrier: current.carrier ?? '', number: current.tracking_number })}
      </p>
      <p className={styles.scanDetail}>
        {s('courierFor', {
          customer: current.customer ?? '—',
          shop: current.shop_name,
          description: current.order_description,
        })}
      </p>

      {/* Registered by the customer as a pre-alert: say so, and whether the
          invoice came with it (the office needs it for customs). */}
      {current.prealert_reference && (
        <p className={styles.scanDetail}>
          {s('prealertLine', {
            reference: current.prealert_reference,
            invoice: current.invoice_files ? s('invoiceYes', { count: current.invoice_files }) : s('invoiceNo'),
          })}
        </p>
      )}

      {message && <Banner tone={message.tone}>{message.text}</Banner>}

      {current.arrived ? (
        !message && (
          <Banner tone="info">
            {s('alreadyArrived', { when: when(current.arrived_at), name: current.arrived_by ?? '—' })}
          </Banner>
        )
      ) : (
        <button type="button" className={styles.scanAction} disabled={busy} onClick={confirm}>
          {busy ? s('confirming') : s('confirmArrival')}
        </button>
      )}

      {/* Already in one of our shipments: carry on with it. */}
      {current.arrived && onOpenShipment && (
        <button type="button" className={styles.scanSecondary} onClick={onOpenShipment}>
          {t('dashboard.flow.scan.packageFound')}: {current.package_tracking_number}
        </button>
      )}
    </div>
  );
}

/** What a scan found, and the one thing to do about it. */
function Result({ result, onStart, busy, onOpenShipment }) {
  return (
    <>
      {result.courier && (
        <CourierParcel
          code={result.code}
          courier={result.courier}
          onOpenShipment={result.shipment ? () => onOpenShipment(result.shipment.id) : undefined}
        />
      )}
      <MatchCard result={result} onStart={onStart} busy={busy} />
    </>
  );
}

/** The intake card: the sheet, shipment or booking the code belongs to. */
function MatchCard({ result, onStart, busy }) {
  const { t } = useLanguage();
  const { match, code, sheet, package: shipment, booking } = result;

  if (match === 'sheet') {
    return (
      <div className={styles.scanResult}>
        <p className={styles.scanResultHead}>{t('dashboard.flow.scan.sheetFound')}</p>
        <p className={styles.scanCode}>{sheet.label}</p>

        <div className={styles.scanBadges}>
          <StatusBadge tone={sheet.status === 'draft' ? 'attention' : 'done'}>
            {sheet.status_display}
          </StatusBadge>
          {sheet.revision > 1 && (
            <StatusBadge tone="attention">{fill(t('dashboard.flow.scan.version'), { number: sheet.revision })}</StatusBadge>
          )}
        </div>

        <p className={styles.scanDetail}>
          {sheet.destination || t('dashboard.flow.scan.noDestination')}
          {sheet.colli_count ? ` · ${sheet.colli_count} colli` : ''}
          {sheet.status === 'draft' && sheet.missing?.length > 0
            ? ` · ${fill(t('dashboard.flow.scan.stillToFill'), { count: sheet.missing.length })}`
            : ''}
        </p>

        <button type="button" className={styles.scanAction} onClick={onStart}>
          {t('dashboard.flow.scan.openSheet')}
        </button>
      </div>
    );
  }

  if (match === 'package') {
    return (
      <div className={styles.scanResult}>
        <p className={styles.scanResultHead}>{t('dashboard.flow.scan.packageFound')}</p>
        <p className={styles.scanCode}>{shipment.tracking_number}</p>
        <p className={styles.scanDetail}>
          {shipment.customer}
          {shipment.destination ? ` · ${shipment.destination}` : ''}
        </p>

        <button
          type="button"
          className={styles.scanAction}
          disabled={busy}
          onClick={onStart}
        >
          {busy ? t('dashboard.flow.scan.starting') : t('dashboard.flow.scan.startIntake')}
        </button>
      </div>
    );
  }

  if (match === 'booking') {
    return (
      <div className={styles.scanResult}>
        <p className={styles.scanResultHead}>{t('dashboard.flow.scan.bookingFound')}</p>
        <p className={styles.scanCode}>{booking.shipping_number}</p>
        <p className={styles.scanDetail}>
          {booking.sender} → {booking.recipient}
          {booking.destination ? ` · ${booking.destination}` : ''}
        </p>

        <button
          type="button"
          className={styles.scanAction}
          disabled={busy}
          onClick={onStart}
        >
          {busy ? t('dashboard.flow.scan.starting') : t('dashboard.flow.scan.startIntake')}
        </button>
      </div>
    );
  }

  // Nothing recognised it. A normal answer, not a failure: goods arrive with
  // a supplier's own barcode and nothing else every day of the week.
  return (
    <div className={styles.scanResult}>
      <p className={styles.scanResultHead}>{t('dashboard.flow.scan.nothingFound')}</p>
      <p className={styles.scanCode}>{code}</p>
      <p className={styles.scanDetail}>
        {t('dashboard.flow.scan.nothingText')}
      </p>

      <button
        type="button"
        className={styles.scanAction}
        disabled={busy}
        onClick={onStart}
      >
        {busy ? t('dashboard.flow.scan.starting') : t('dashboard.flow.scan.startSheet')}
      </button>
    </div>
  );
}

export default function Scan() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [result, setResult] = useState(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const lookUp = useCallback(
    async (code) => {
      const trimmed = (code ?? '').trim();
      if (!trimmed) return;

      setError('');
      setResult(null);
      setBusy(true);

      try {
        const found = await scanCode(trimmed);

        // A package on file goes straight to its workflow - the fastest path
        // the floor has. The scan is recorded on the package's history first.
        // Except a courier's parcel whose arrival is not recorded yet: that
        // waits here for the one tap that records it (CourierParcel).
        const arrivalPending = found.courier && !found.courier.arrived;
        if (found.shipment && !arrivalPending) {
          await recordScan(found.shipment.id, trimmed);
          navigate(`/warehouse/packages/${found.shipment.id}`);
          return;
        }

        setResult(found);
      } catch {
        setError('lookupError');
      } finally {
        setBusy(false);
      }
    },
    [navigate],
  );

  // Destructured rather than kept as one `scanner` object. The hook returns
  // a ref among its values, and reading anything off that object during
  // render reads as reading a ref - which is a rule worth keeping, because a
  // ref really does not re-render when it changes.
  const {
    videoRef,
    start: startCamera,
    stop: stopCamera,
    running,
    starting,
    error: cameraError,
  } = useScanner(lookUp);

  const typeInRef = useRef(null);

  // Ready to scan the moment the page opens: the camera on a tablet, the
  // text box (for a handheld scanner gun) on a computer.
  useEffect(() => {
    if (isTouchDevice()) {
      startCamera();
    } else {
      typeInRef.current?.focus();
    }
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Open the sheet a scan found, or start the one it says is missing. */
  async function act() {
    if (result.match === 'sheet') {
      navigate(`/warehouse/intake?sheet=${result.sheet.id}`);
      return;
    }

    setBusy(true);
    setError('');

    try {
      // The code goes on as the reference whatever it matched, so the next
      // person to scan this box finds the sheet rather than starting a
      // second one. The link is what makes the office side join up.
      const sheet = await createIntakeSheet({
        reference: result.code,
        package: result.package?.id ?? null,
        booking: result.booking?.id ?? null,
      });

      navigate(`/warehouse/intake?sheet=${sheet.id}`);
    } catch {
      setError('startError');
      setBusy(false);
    }
  }

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>{t('dashboard.flow.scan.title')}</h1>
        <p className={styles.subtitle}>{t('dashboard.flow.scan.lead')}</p>
      </header>

      {/* Both hold a key, so the message follows the chosen language. */}
      <Banner tone="error">{error || cameraError ? t(`dashboard.flow.scan.${error || cameraError}`) : ''}</Banner>

      <div className={styles.scanStage}>
        {/* Always mounted, hidden until running. zxing is handed this element
            when the camera starts, and an element created in the same tick is
            not laid out yet. */}
        <video
          ref={videoRef}
          className={styles.scanVideo}
          hidden={!running}
          muted
          playsInline
        />

        {running ? (
          <button
            type="button"
            className={styles.scanSecondary}
            onClick={stopCamera}
          >
            {t('dashboard.flow.scan.stopCamera')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.scanStart}
            disabled={starting}
            onClick={startCamera}
          >
            {starting ? t('dashboard.flow.scan.startingCamera') : t('dashboard.flow.scan.startCamera')}
          </button>
        )}
      </div>

      {/* A package on file has already been opened in its workflow by
          lookUp. Anything else gets the intake answer as before. */}
      {result && (
        <Result
          result={result}
          onStart={act}
          busy={busy}
          onOpenShipment={async (id) => {
            await recordScan(id, result.code);
            navigate(`/warehouse/packages/${id}`);
          }}
        />
      )}

      {/* Not tucked behind a link. A torn label is an ordinary morning, and
          typing the number has to be as reachable as the camera. */}
      <form
        className={styles.scanTypeIn}
        onSubmit={(event) => {
          event.preventDefault();
          stopCamera();
          lookUp(typed);
        }}
      >
        <label className={styles.intakeField}>
          <span className={styles.intakeLabel}>{t('dashboard.flow.scan.typeLabel')}</span>
          <input
            ref={typeInRef}
            className={styles.intakeInput}
            enterKeyHint="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="CI-1001"
            // Off on all four: a code is not a word, and a phone keyboard
            // that corrects it is a phone keyboard that breaks it.
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck="false"
          />
        </label>

        <button type="submit" className={styles.scanSecondary} disabled={busy}>
          {busy ? t('dashboard.flow.scan.looking') : t('dashboard.flow.scan.lookUp')}
        </button>
      </form>
    </>
  );
}
