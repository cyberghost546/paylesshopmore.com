// src/pages/Dashboard/IntakePhotos.jsx
//
// "Foto's van de schade" on the intake sheet: shown once "Schade aanwezig?"
// is Ja, so the damage is on record with the sheet that reports it.
//
// Two ways to add a photo:
//   - "Foto maken" opens the camera right here on the page - the webcam on a
//     computer, the back camera on a phone or tablet - and "Maak foto" takes
//     the picture. The camera stays open for the next one until "Sluiten".
//   - "Bestand kiezen" picks a photo that is already on the device.
//
// A photo is uploaded as soon as it is taken, so there is no save button. A
// photo of the wrong box can be removed with its ×. Once the sheet is
// released the photos are locked with it: they can be looked at, not changed.
// At most MAX_PHOTOS, JPEG, PNG or WebP, 10 MB each - the same limits the
// server checks (backend warehouse/operations.py add_intake_photos).

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../api/client';
import StoredPhoto from '../../components/StoredPhoto/StoredPhoto';
import { deleteIntakePhoto, listIntakePhotos, uploadIntakePhotos } from '../../api/staff';
import { captureJpeg } from '../../measurement/cameraService';
import { useCamera } from '../Warehouse/camera/useCamera';
import { cameraProblem } from './cameraProblems';
import { Banner } from './ui';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

const MAX_PHOTOS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';

/**
 * @param {{ sheetId: number, show: boolean, locked: boolean }} props
 *   show    whether damage has been reported (Schade aanwezig? = Ja)
 *   locked  the sheet is released: photos can be seen, not changed
 */
export default function IntakePhotos({ sheetId, show, locked }) {
  const d = usePageText('intakeCamera');
  const fileInput = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The live camera. `cameraOpen` is whether the panel is on screen; the
  // hook does the actual switching on and off.
  const {
    videoRef,
    status: cameraStatus,
    error: cameraError,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();
  const [cameraOpen, setCameraOpen] = useState(false);

  // Loaded once per sheet, whether or not the box is ticked yet: a sheet that
  // was switched back to Nee still shows the photos it already has (below).
  useEffect(() => {
    let live = true;
    listIntakePhotos(sheetId)
      .then((rows) => {
        if (live) setPhotos(rows);
      })
      .catch(() => {
        if (live) setError(d('photosLoadFailed'));
      });
    return () => {
      live = false;
    };
  }, [sheetId, d]);

  // Photos can be added while the sheet is a draft and damage is reported.
  const canAdd = !locked && show;
  // The camera panel is on screen only while photos can be added: a sheet
  // released (or switched to Nee) with the camera open closes it.
  const cameraShown = cameraOpen && canAdd;

  // Switch the camera on when the panel shows and off when it goes. On, not
  // straight from the click: the <video> it shows in must be on the page first.
  useEffect(() => {
    if (cameraShown) startCamera();
    else stopCamera();
  }, [cameraShown, startCamera, stopCamera]);

  // Nothing to show: no damage reported and no photos taken.
  if (!show && photos.length === 0) return null;

  const full = photos.length >= MAX_PHOTOS;

  async function add(files) {
    const chosen = [...files];
    if (!chosen.length) return;
    // Checked here first so nobody waits for an upload the server will refuse.
    const tooBig = chosen.find((file) => file.size > MAX_BYTES);
    if (tooBig) {
      setError(d('tooBig', { name: tooBig.name }));
      return;
    }
    if (photos.length + chosen.length > MAX_PHOTOS) {
      setError(d('tooMany', { max: MAX_PHOTOS }));
      return;
    }

    setBusy(true);
    setError('');
    try {
      const rows = await uploadIntakePhotos(sheetId, chosen);
      setPhotos(rows);
      // Full now: nothing more to take, so the camera can go off.
      if (rows.length >= MAX_PHOTOS) setCameraOpen(false);
    } catch (failure) {
      setError(
        failure?.status === 409
          ? d('sheetReleased')
          : failure?.fields?.photos?.[0] || d('photoSaveFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  // "Maak foto": the picture on screen right now, as a JPEG, uploaded.
  async function takePhoto() {
    const file = await captureJpeg(videoRef.current);
    if (!file) {
      setError(d('starting'));
      return;
    }
    await add([file]);
  }

  async function remove(photo) {
    setBusy(true);
    setError('');
    try {
      await deleteIntakePhoto(sheetId, photo.id);
      setPhotos((list) => list.filter((item) => item.id !== photo.id));
    } catch {
      setError(d('photoRemoveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.intakeFieldWide}>
      <span className={styles.intakeLabel}>{d('damagePhotos')}</span>

      <Banner tone="error">{error}</Banner>

      {photos.length > 0 && (
        <div className={styles.intakePhotos}>
          {photos.map((photo, index) => (
            <span key={photo.id} className={styles.intakePhotoPick}>
              {/* Tap a photo to see it full size in a new tab. */}
              <a href={apiUrl(photo.url)} target="_blank" rel="noopener noreferrer">
                <StoredPhoto
                  src={apiUrl(photo.url)}
                  alt={d('photoAlt', { number: index + 1 })}
                  className={styles.intakePhoto}
                />
              </a>
              {!locked && (
                <button
                  type="button"
                  className={styles.intakePhotoRemove}
                  disabled={busy}
                  aria-label={d('removePhoto', { number: index + 1 })}
                  onClick={() => remove(photo)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* The live camera, while it is open. */}
      {cameraShown && (
        <div className={styles.intakeCamera}>
          {cameraError ? (
            <p className={styles.intakeHint}>{cameraProblem(cameraError, d)}</p>
          ) : (
            // muted + playsInline: needed for the preview to play on iPhone.
            <video ref={videoRef} className={styles.intakeCameraVideo} muted playsInline />
          )}
          <div className={styles.intakeCameraButtons}>
            {!cameraError && (
              <button
                type="button"
                className={styles.intakeRelease}
                disabled={busy || full || cameraStatus !== 'live'}
                onClick={takePhoto}
              >
                {busy ? d('saving') : cameraStatus === 'live' ? d('takePhoto') : d('cameraStarting')}
              </button>
            )}
            <button type="button" className={styles.rowButton} onClick={() => setCameraOpen(false)}>
              {d('close')}
            </button>
          </div>
        </div>
      )}

      {canAdd && (
        <>
          {/* Hidden: "Bestand kiezen" opens it. */}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            className={styles.srOnly}
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              add(event.target.files);
              // Cleared, so choosing the same file again still counts as a change.
              event.target.value = '';
            }}
          />
          <div className={styles.intakeCameraButtons}>
            {!cameraShown && (
              <button
                type="button"
                className={styles.rowButton}
                disabled={busy || full}
                onClick={() => setCameraOpen(true)}
              >
                {photos.length ? d('anotherPhoto', { count: photos.length, max: MAX_PHOTOS }) : d('openCamera')}
              </button>
            )}
            <button
              type="button"
              className={styles.rowButton}
              disabled={busy || full}
              onClick={() => fileInput.current?.click()}
            >
              {d('chooseFile')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
