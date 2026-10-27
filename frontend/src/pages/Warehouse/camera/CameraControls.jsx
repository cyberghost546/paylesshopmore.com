// src/pages/Warehouse/camera/CameraControls.jsx
//
// The buttons under the camera. Which ones show depends on where the worker
// is in the flow, so there is only ever one obvious next step:
//
//   camera off      ->  Start camera
//   camera on       ->  Scan package, Stop camera
//   measuring       ->  (buttons disabled)

import { useLanguage } from '../../../i18n/useLanguage';
import ops from '../Ops.module.css';
import styles from './Camera.module.css';

/**
 * @param {{ status: 'off'|'starting'|'live', scanning: boolean,
 *           onStart: () => void, onStop: () => void, onScan: () => void }} props
 */
export default function CameraControls({ status, scanning, onStart, onStop, onScan }) {
  const { t } = useLanguage();

  if (status !== 'live') {
    return (
      <div className={styles.controls}>
        <button
          type="button"
          className={`${ops.button} ${ops.primary} ${styles.bigButton}`}
          onClick={onStart}
          disabled={status === 'starting'}
        >
          {status === 'starting' ? t('dashboard.flow.camera.startingButton') : t('dashboard.flow.camera.start')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={`${ops.button} ${ops.primary} ${styles.bigButton}`}
        onClick={onScan}
        disabled={scanning}
      >
        {scanning ? t('dashboard.flow.camera.scanningButton') : t('dashboard.flow.camera.scan')}
      </button>
      <button
        type="button"
        className={`${ops.button} ${ops.secondary}`}
        onClick={onStop}
        disabled={scanning}
      >
        {t('dashboard.flow.camera.stop')}
      </button>
    </div>
  );
}
