// src/pages/Warehouse/camera/ConfirmationCard.jsx
//
// "Measurement confirmed." with the numbers, the package they belong to, and
// Save Measurement. After saving it says where the record went - which, in
// this prototype, is this page only (see measurement/apiService.js).

import { useLanguage } from '../../../i18n/useLanguage';
import ops from '../Ops.module.css';
import { formatCentimeters } from '../../../measurement/measurementUtils';
import styles from './Camera.module.css';

/**
 * @param {{ dimensions: { length: number, width: number, height: number },
 *           packageId: string, onPackageId: (value: string) => void,
 *           saving: boolean, saved: object|null, saveError: string|null,
 *           onSave: () => void, onNext: () => void }} props
 */
export default function ConfirmationCard({
  dimensions,
  packageId,
  onPackageId,
  saving,
  saved,
  saveError,
  onSave,
  onNext,
}) {
  const { t, language } = useLanguage();
  const sides = ['length', 'width', 'height'];

  return (
    <section className={`${styles.result} ${styles.confirmed}`} aria-labelledby="camera-confirmed-title">
      <h2 className={styles.resultTitle} id="camera-confirmed-title">
        {t('dashboard.flow.camera.confirmation.title')}
      </h2>

      <dl className={styles.sizes}>
        {sides.map((side) => (
          <div key={side} className={styles.size}>
            <dt className={styles.sizeLabel}>{t(`dashboard.flow.camera.result.${side}`)}</dt>
            <dd className={styles.sizeValue}>
              {formatCentimeters(dimensions[side], language)}
              <span className={styles.sizeUnit}> cm</span>
            </dd>
          </div>
        ))}
      </dl>

      {saved ? (
        // After saving: what was saved, and the way on to the next package.
        <>
          <p className={`${ops.message} ${ops.messageSuccess}`} role="status">
            {t('dashboard.flow.camera.confirmation.saved')}
          </p>
          <div className={styles.controls}>
            <button
              type="button"
              className={`${ops.button} ${ops.primary} ${styles.bigButton}`}
              onClick={onNext}
            >
              {t('dashboard.flow.camera.confirmation.next')}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Which package this is. Typed (or later: scanned from the label). */}
          <label className={ops.field}>
            <span className={ops.label}>{t('dashboard.flow.camera.confirmation.packageId')}</span>
            <input
              className={ops.input}
              value={packageId}
              onChange={(event) => onPackageId(event.target.value)}
              placeholder="PLSM-0001"
              autoComplete="off"
            />
          </label>

          {saveError && (
            <p className={`${ops.message} ${ops.messageError}`} role="alert">
              {saveError}
            </p>
          )}

          <div className={styles.controls}>
            <button
              type="button"
              className={`${ops.button} ${ops.primary} ${styles.bigButton}`}
              onClick={onSave}
              disabled={saving}
            >
              {saving ? t('dashboard.flow.camera.confirmation.saving') : t('dashboard.flow.camera.confirmation.save')}
            </button>
            <button type="button" className={`${ops.button} ${ops.secondary}`} onClick={onNext}>
              {t('dashboard.flow.camera.scanAgain')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
