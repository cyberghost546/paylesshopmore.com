// src/pages/Warehouse/camera/CameraPreview.jsx
//
// The live camera picture with the placement frame on top, and what to show
// instead when the camera is off, starting, or refused.

import { useLanguage } from '../../../i18n/useLanguage';
import { GuideOverlay } from './MeasurementGuide';
import styles from './Camera.module.css';

/**
 * @param {{ videoRef: object, status: 'off'|'starting'|'live', error: string|null,
 *           scanning: boolean }} props
 */
export default function CameraPreview({ videoRef, status, error, scanning }) {
  const { t } = useLanguage();

  return (
    <div className={styles.preview}>
      {/* Always in the page, even while off: cameraService needs the element
          to exist before the camera starts. Hidden until there is a picture. */}
      <video
        ref={videoRef}
        className={`${styles.video} ${status === 'live' ? '' : styles.hidden}`}
        playsInline
        muted
        aria-label={t('dashboard.flow.camera.previewLabel')}
      />

      {status === 'live' && <GuideOverlay />}

      {/* While measuring: the picture stays, dimmed, with a message on top. */}
      {scanning && (
        <div className={styles.scanning} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          {t('dashboard.flow.camera.scanning')}
        </div>
      )}

      {/* Empty states: no picture yet. */}
      {status !== 'live' && (
        <div className={styles.placeholder}>
          {status === 'starting' ? (
            <p role="status">
              <span className={styles.spinner} aria-hidden="true" />
              {t('dashboard.flow.camera.starting')}
            </p>
          ) : error ? (
            // The camera was refused or failed: say why, and what to do.
            <p className={styles.placeholderError} role="alert">
              {t(`dashboard.flow.camera.errors.${error}`)}
            </p>
          ) : (
            <p>{t('dashboard.flow.camera.off')}</p>
          )}
        </div>
      )}
    </div>
  );
}
