// src/pages/Warehouse/PackageMeasurement.jsx
//
// "Package Measurement": point the camera at a package, scan, and read its
// length, width and height in centimetres.
//
// PROTOTYPE. The camera is real; the measurement is not yet - see
// measurement/measurementService.js. The page says so on screen, because a
// webcam cannot measure in centimetres without calibration, and nobody should
// read these numbers as a tape-measure reading.
//
// How the page is put together:
//
//   useCamera()          the camera: start, stop, take a picture   (camera/useCamera.js)
//   measurePackage()     picture -> sizes + problems               (measurement/measurementService.js)
//   saveMeasurement()    the confirmed record                      (measurement/apiService.js)
//
//   CameraPreview        live picture + placement frame
//   CameraControls       Start / Scan / Stop
//   MeasurementGuide     what to check before scanning
//   MeasurementResult    the three sizes, problems, Confirm / Scan again
//   ConfirmationCard     "Measurement confirmed." + Save
//
// The flow, as `step`:
//   'measure'   camera and scan, until a measurement is confirmed
//   'confirmed' the confirmation card, until it is saved or scanned again

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { useLanguage } from '../../i18n/useLanguage';
import { saveMeasurement } from '../../measurement/apiService';
import { DEMO_MODE, measurePackage } from '../../measurement/measurementService';
import { formatCentimeters } from '../../measurement/measurementUtils';
import CameraControls from './camera/CameraControls';
import CameraPreview from './camera/CameraPreview';
import ConfirmationCard from './camera/ConfirmationCard';
import MeasurementGuide from './camera/MeasurementGuide';
import MeasurementResult from './camera/MeasurementResult';
import { useCamera } from './camera/useCamera';
import ops from './Ops.module.css';
import styles from './camera/Camera.module.css';

export default function PackageMeasurement() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const camera = useCamera();

  // A package can be passed in the address: /warehouse/measurements/camera?package=PLSM-1001
  const [searchParams] = useSearchParams();
  const [packageId, setPackageId] = useState(searchParams.get('package') ?? '');

  const [step, setStep] = useState('measure');
  const [scanning, setScanning] = useState(false);
  // What the last scan found (sizes and problems), or null before the first.
  const [result, setResult] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [saveError, setSaveError] = useState(null);
  // On a phone the result is below the camera, out of sight: after a scan the
  // page scrolls to it, so the worker sees that something happened.
  const resultRef = useRef(null);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [result]);

  // Everything saved while this page was open. Kept in React state only - it
  // is gone on reload. A database comes later (measurement/apiService.js).
  const [history, setHistory] = useState([]);

  async function scan() {
    setScanning(true);
    try {
      // One still picture from the live preview, then measure it.
      const frame = camera.capture();
      setResult(await measurePackage(frame));
    } finally {
      setScanning(false);
    }
  }

  function scanAgain() {
    setResult(null);
    setSaved(null);
    setSaveError(null);
    setStep('measure');
    // The camera may have been stopped; start it again so the next scan is
    // one tap away.
    if (camera.status === 'off') camera.start();
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const answer = await saveMeasurement({
        packageId: packageId.trim(),
        dimensions: result.dimensions,
        workerId: user?.id ?? null,
      });
      setSaved(answer.record);
      setHistory((list) => [answer.record, ...list]);
    } catch {
      setSaveError(t('dashboard.flow.camera.confirmation.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={ops.page}>
      <div className={ops.pageHead}>
        <div>
          <Link to="/warehouse/measurements" className={ops.backLink}>
            {t('dashboard.flow.camera.back')}
          </Link>
          <h1 className={ops.pageTitle}>{t('dashboard.flow.camera.title')}</h1>
          <p className={ops.pageLead}>{t('dashboard.flow.camera.lead')}</p>
        </div>
      </div>

      {/* Said plainly: these are not real measurements yet. */}
      {DEMO_MODE && (
        <p className={`${ops.message} ${ops.messageInfo}`} role="note">
          {t('dashboard.flow.camera.demoNotice')}
        </p>
      )}

      <div className={styles.layout}>
        {/* Left (or top, on a phone): the camera. */}
        <section className={`${ops.card} ${styles.cameraCard}`}>
          <CameraPreview
            videoRef={camera.videoRef}
            status={camera.status}
            error={camera.error}
            scanning={scanning}
          />
          {step === 'measure' && (
            <CameraControls
              status={camera.status}
              scanning={scanning}
              onStart={camera.start}
              onStop={camera.stop}
              onScan={scan}
            />
          )}
          <MeasurementGuide />
        </section>

        {/* Right (or below): the result, then the confirmation. */}
        <div className={styles.side}>
          <div className={ops.card} ref={resultRef}>
            {step === 'measure' ? (
              <MeasurementResult
                result={result}
                onConfirm={() => setStep('confirmed')}
                onScanAgain={scanAgain}
              />
            ) : (
              <ConfirmationCard
                dimensions={result.dimensions}
                packageId={packageId}
                onPackageId={setPackageId}
                saving={saving}
                saved={saved}
                saveError={saveError}
                onSave={save}
                onNext={scanAgain}
              />
            )}
          </div>

          {/* What was saved while this page was open. */}
          {history.length > 0 && (
            <section className={ops.card} aria-labelledby="camera-history-title">
              <h2 className={ops.cardTitle} id="camera-history-title">
                {t('dashboard.flow.camera.history.title')}
              </h2>
              <ul className={styles.history}>
                {history.map((record) => (
                  <li key={record.measuredAt} className={styles.historyRow}>
                    <span className={styles.historyPackage}>
                      {record.packageId || t('dashboard.flow.camera.history.noPackage')}
                    </span>
                    <span>
                      {[record.length, record.width, record.height]
                        .map((value) => formatCentimeters(value, language))
                        .join(' × ')}{' '}
                      cm
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
