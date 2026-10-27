// src/pages/Warehouse/PackagePhotos.jsx
//
// "Foto's voor de klant" on the warehouse package page: photos of the
// package that the CUSTOMER sees, in the shipment's pop-up on their profile
// page ("Mijn zendingen"). Not for damage - that has its own report, which
// stays inside the company.
//
// "Foto maken" opens the camera on a phone or tablet; a photo is uploaded
// as soon as it is taken, so there is no separate save button. A photo of
// the wrong box can be removed with its ×. At most MAX_PHOTOS per package,
// JPEG, PNG or WebP, 10 MB each - the same limits the server checks
// (backend warehouse/operations.py add_package_photos).

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../api/client';
import StoredPhoto from '../../components/StoredPhoto/StoredPhoto';
import {
  deletePackagePhoto,
  errorMessage,
  fieldError,
  listPackagePhotos,
  uploadPackagePhotos,
} from '../../api/warehouse';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { Message } from './opsUi';
import styles from './Ops.module.css';

const MAX_PHOTOS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp';
const T = 'dashboard.flow.photos.';

/** @param {{ shipmentId: number, onChanged?: () => void }} props */
export default function PackagePhotos({ shipmentId, onChanged }) {
  const { t } = useLanguage();
  const fileInput = useRef(null);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let live = true;
    listPackagePhotos(shipmentId)
      .then((rows) => {
        if (live) setPhotos(rows);
      })
      .catch(() => {
        if (live) setMessage({ tone: 'error', text: t(`${T}loadError`) });
      });
    return () => {
      live = false;
    };
    // `t` is left out on purpose: a language switch must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  async function add(files) {
    const chosen = [...files];
    if (!chosen.length) return;
    const tooBig = chosen.find((file) => file.size > MAX_BYTES);
    if (tooBig) {
      setMessage({ tone: 'error', text: fill(t(`${T}tooBig`), { name: tooBig.name }) });
      return;
    }
    if (photos.length + chosen.length > MAX_PHOTOS) {
      setMessage({ tone: 'error', text: fill(t(`${T}tooMany`), { max: MAX_PHOTOS }) });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      setPhotos(await uploadPackagePhotos(shipmentId, chosen));
      setMessage({ tone: 'success', text: t(`${T}saved`) });
      onChanged?.();
    } catch (error) {
      setMessage({
        tone: 'error',
        text: fieldError(error, 'photos') || errorMessage(error, t(`${T}saveError`), t),
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(photo) {
    setBusy(true);
    setMessage(null);
    try {
      await deletePackagePhoto(shipmentId, photo.id);
      setPhotos((list) => list.filter((item) => item.id !== photo.id));
      onChanged?.();
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error, t(`${T}saveError`), t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="package-photos-heading">
      <h2 id="package-photos-heading" className={styles.cardTitle}>
        {t(`${T}title`)}
      </h2>
      <p className={styles.pageLead}>{t(`${T}lead`)}</p>

      <Message tone={message?.tone}>{message?.text}</Message>

      {photos.length > 0 && (
        <div className={styles.photos}>
          {photos.map((photo, index) => (
            <span key={photo.id} className={styles.photoPick}>
              <a href={apiUrl(photo.url)} target="_blank" rel="noopener noreferrer">
                {/* A grey "no longer available" tile when the file is gone. */}
                <StoredPhoto
                  src={apiUrl(photo.url)}
                  alt={fill(t(`${T}photo`), { number: index + 1 })}
                  className={styles.photo}
                />
              </a>
              <button
                type="button"
                className={styles.photoRemove}
                disabled={busy}
                aria-label={fill(t(`${T}remove`), { number: index + 1 })}
                onClick={() => remove(photo)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        // Opens the rear camera straight away on tablets and phones.
        capture="environment"
        multiple
        className={styles.fileInput}
        aria-label={t(`${T}take`)}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />

      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || photos.length >= MAX_PHOTOS}
          onClick={() => fileInput.current?.click()}
        >
          {busy
            ? t('dashboard.flow.common.saving')
            : photos.length
              ? fill(t(`${T}takeMore`), { count: photos.length, max: MAX_PHOTOS })
              : t(`${T}take`)}
        </button>
      </div>
    </section>
  );
}
