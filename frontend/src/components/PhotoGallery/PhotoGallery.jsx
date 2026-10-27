// src/components/PhotoGallery/PhotoGallery.jsx
//
// The photos the warehouse took of a customer's package, on "My shipments".
//
// READ THIS FIRST - what it does:
//   - A grid of square thumbnails. The first one is shown larger, so the
//     customer sees their parcel at a glance.
//   - Clicking a photo opens it big, over the page (a "lightbox"), with:
//       * Previous / Next buttons, and the keyboard's left/right arrows
//       * "2 / 5" so you know where you are
//       * the date the warehouse took it
//       * Download (the original file) and Close (or the Esc key)
//   - A photo whose file is gone from the server shows a grey "no longer
//     available" tile instead of a broken image (components/StoredPhoto).
//
// The photos come from the API as { id, url, uploaded_at }. The url is a
// protected address (backend accounts/views.py PackageViewSet.photo) that only
// answers for the customer the package belongs to - the session cookie goes
// with it because it is the same site. It is never a public link.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../api/client';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import StoredPhoto from '../StoredPhoto/StoredPhoto';
import styles from './PhotoGallery.module.css';

/**
 * @param {object} props
 * @param {{ id: number, url: string, uploaded_at?: string }[]} props.photos
 * @param {string} props.title      shown above the grid, e.g. "Photos of your package"
 */
export default function PhotoGallery({ photos, title }) {
  const { t, language } = useLanguage();
  const g = (key, values) => fill(t(`profile.shipments.details.gallery.${key}`), values);
  // Which photo is open in the lightbox, or null when it is closed.
  const [open, setOpen] = useState(null);
  const closeButton = useRef(null);
  const lastThumb = useRef(null);

  const count = photos?.length ?? 0;
  const close = useCallback(() => {
    setOpen(null);
    // Back to the thumbnail that was clicked, for keyboard users.
    lastThumb.current?.focus();
  }, []);
  const step = useCallback((by) => setOpen((index) => (index + by + count) % count), [count]);

  // Keyboard: Esc closes, the arrows go to the previous / next photo.
  useEffect(() => {
    if (open === null) return undefined;
    closeButton.current?.focus();
    function onKey(event) {
      if (event.key === 'Escape') close();
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, step]);

  if (!count) return null;

  const name = (index) => fill(t('profile.shipments.details.photo'), { number: index + 1 });
  const takenOn = (photo) =>
    photo.uploaded_at
      ? g('takenOn', {
          date: new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(
            new Date(photo.uploaded_at),
          ),
        })
      : '';

  const current = open === null ? null : photos[open];

  return (
    <div className={styles.gallery}>
      <p className={styles.title}>
        {title} <span className={styles.count}>({count})</span>
      </p>

      <ul className={styles.grid}>
        {photos.map((photo, index) => (
          <li key={photo.id} className={index === 0 && count > 2 ? styles.featured : undefined}>
            <button
              type="button"
              className={styles.thumb}
              onClick={(event) => {
                lastThumb.current = event.currentTarget;
                setOpen(index);
              }}
              aria-label={`${t('profile.shipments.details.openPhoto')} ${name(index)}`}
            >
              <StoredPhoto src={apiUrl(photo.url)} alt={name(index)} className={styles.thumbImage} />
            </button>
          </li>
        ))}
      </ul>

      {current && (
        // The lightbox. Clicking the dark background closes it too.
        <div
          className={styles.backdrop}
          role="dialog"
          aria-modal="true"
          aria-label={g('label', { name: name(open) })}
          onClick={(event) => event.target === event.currentTarget && close()}
        >
          <figure className={styles.viewer}>
            <div className={styles.viewerTop}>
              <span className={styles.counter}>
                {open + 1} / {count}
              </span>
              <a
                className={styles.topButton}
                href={apiUrl(current.url)}
                download={`${name(open)}.jpg`}
              >
                {g('download')}
              </a>
              <button ref={closeButton} type="button" className={styles.topButton} onClick={close}>
                {g('close')}
              </button>
            </div>

            <StoredPhoto
              key={current.id}
              src={apiUrl(current.url)}
              alt={name(open)}
              className={styles.large}
              loading="eager"
            />

            <figcaption className={styles.caption}>
              {name(open)}
              {current.uploaded_at && <span className={styles.captionDate}> · {takenOn(current)}</span>}
            </figcaption>

            {count > 1 && (
              <>
                <button
                  type="button"
                  className={`${styles.arrow} ${styles.arrowLeft}`}
                  onClick={() => step(-1)}
                  aria-label={g('previous')}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={`${styles.arrow} ${styles.arrowRight}`}
                  onClick={() => step(1)}
                  aria-label={g('next')}
                >
                  ›
                </button>
              </>
            )}
          </figure>
        </div>
      )}
    </div>
  );
}
