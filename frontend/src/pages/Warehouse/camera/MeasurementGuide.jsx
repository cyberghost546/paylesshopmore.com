// src/pages/Warehouse/camera/MeasurementGuide.jsx
//
// The frame drawn over the camera picture, showing where the package goes,
// and the three things to check before scanning. Pure presentation: no state.

import { useLanguage } from '../../../i18n/useLanguage';
import styles from './Camera.module.css';

/** The overlay on top of the live picture. Ignored by screen readers: the instructions below say the same in words. */
export function GuideOverlay() {
  const { t } = useLanguage();
  return (
    <div className={styles.overlay} aria-hidden="true">
      {/* The dashed frame the package should fill. */}
      <div className={styles.frame}>
        <span className={styles.frameLabel}>{t('dashboard.flow.camera.guide.overlay')}</span>
        {/* Where the reference marker goes: next to the box, in the corner. */}
        <span className={styles.markerSpot}>{t('dashboard.flow.camera.guide.markerSpot')}</span>
      </div>
    </div>
  );
}

/** The instructions under the camera. */
export default function MeasurementGuide() {
  const { t } = useLanguage();
  const steps = ['inside', 'marker', 'steady'];
  return (
    <div className={styles.guide}>
      <h2 className={styles.guideTitle}>{t('dashboard.flow.camera.guide.title')}</h2>
      <ol className={styles.guideSteps}>
        {steps.map((step) => (
          <li key={step}>{t(`dashboard.flow.camera.guide.${step}`)}</li>
        ))}
      </ol>
    </div>
  );
}
