// src/pages/Warehouse/camera/MeasurementResult.jsx
//
// The three sizes, large enough to read from a step away, and either the
// problems that stop them being confirmed or the buttons to confirm them.

import { fill } from '../../../i18n/fill';
import { useLanguage } from '../../../i18n/useLanguage';
import { REFERENCE_MARKER_SIZE_CM, formatCentimeters } from '../../../measurement/measurementUtils';
import ops from '../Ops.module.css';
import styles from './Camera.module.css';

/**
 * @param {{ result: object|null, onConfirm: () => void, onScanAgain: () => void }} props
 *   result is what measurementService.measurePackage() returned, or null before the first scan
 */
export default function MeasurementResult({ result, onConfirm, onScanAgain }) {
  const { t, language } = useLanguage();

  // Empty state: nothing scanned yet.
  if (!result) {
    return (
      <section className={styles.result} aria-labelledby="camera-result-title">
        <h2 className={styles.resultTitle} id="camera-result-title">
          {t('dashboard.flow.camera.result.title')}
        </h2>
        <p className={ops.empty}>{t('dashboard.flow.camera.result.empty')}</p>
      </section>
    );
  }

  const { dimensions, problems } = result;
  const ok = problems.length === 0;
  const sides = ['length', 'width', 'height'];

  return (
    <section className={styles.result} aria-labelledby="camera-result-title">
      <h2 className={styles.resultTitle} id="camera-result-title">
        {t('dashboard.flow.camera.result.title')}
      </h2>

      {/* The three numbers. Shown even when something is wrong, as dashes,
          so the layout does not jump between scans. */}
      <dl className={styles.sizes}>
        {sides.map((side) => (
          <div key={side} className={styles.size}>
            <dt className={styles.sizeLabel}>{t(`dashboard.flow.camera.result.${side}`)}</dt>
            <dd className={styles.sizeValue}>
              {formatCentimeters(dimensions?.[side], language)}
              <span className={styles.sizeUnit}> cm</span>
            </dd>
          </div>
        ))}
      </dl>

      {/* How the centimetres were worked out - useful when a number looks wrong. */}
      {dimensions?.scale && (
        <p className={styles.scale}>
          {fill(t('dashboard.flow.camera.result.scale'), {
            scale: formatCentimeters(dimensions.scale, language),
            size: REFERENCE_MARKER_SIZE_CM,
          })}
        </p>
      )}

      {/* Validation: everything that stops this measurement being confirmed. */}
      {!ok && (
        <ul className={styles.problems} role="alert">
          {problems.map((problem) => (
            <li key={problem}>{t(`dashboard.flow.camera.problems.${problem}`)}</li>
          ))}
        </ul>
      )}

      <div className={styles.controls}>
        {ok && (
          <button
            type="button"
            className={`${ops.button} ${ops.primary} ${styles.bigButton}`}
            onClick={onConfirm}
          >
            {t('dashboard.flow.camera.confirm')}
          </button>
        )}
        <button type="button" className={`${ops.button} ${ops.secondary}`} onClick={onScanAgain}>
          {t('dashboard.flow.camera.scanAgain')}
        </button>
      </div>
    </section>
  );
}
