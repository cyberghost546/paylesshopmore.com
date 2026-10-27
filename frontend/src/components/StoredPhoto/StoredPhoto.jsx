// src/components/StoredPhoto/StoredPhoto.jsx
//
// A photo the server keeps (package photos, damage photos, intake photos).
//
// READ THIS FIRST - why this exists:
//   When the photo's file is gone from the server, the browser used to show a
//   broken-image icon with the alt text as a blue link ("Foto 1"), which
//   looks like a bug in the page. The usual cause is not the page at all: the
//   server lost the file (see backend/config/settings.py, "Object storage" -
//   a host without a bucket or a persistent volume forgets uploaded files on
//   every new deploy). The database still lists the photo, so the page asks
//   for it, and the server answers 404 "This photo is missing."
//
//   This shows a clear grey tile instead - "Photo no longer available" - so
//   a worker knows to take the photo again, and the rest of the page (delete
//   button, "Another photo") keeps working as usual.
//
// Use it like an <img>: <StoredPhoto src={apiUrl(photo.url)} alt="Foto 1" className={...} />

import { useState } from 'react';
import { useLanguage } from '../../i18n/useLanguage';

export default function StoredPhoto({ src, alt, className, style, loading = 'lazy' }) {
  const { t } = useLanguage();
  // Which address failed: a new photo (another src) gets its own try.
  const [failedSrc, setFailedSrc] = useState(null);

  if (failedSrc === src) {
    return (
      <span
        className={className}
        style={{
          ...style,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0.5rem',
          boxSizing: 'border-box',
          background: '#f1f5f9',
          color: '#64748b',
          fontSize: '0.8rem',
          lineHeight: 1.3,
          textAlign: 'center',
        }}
        role="img"
        aria-label={`${alt} — ${t('dashboard.flow.photos.missing')}`}
        title={t('dashboard.flow.photos.missingHelp')}
      >
        {t('dashboard.flow.photos.missing')}
      </span>
    );
  }

  return (
    <img src={src} alt={alt} className={className} style={style} loading={loading} onError={() => setFailedSrc(src)} />
  );
}
