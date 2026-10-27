// src/pages/Booking/OrdersField.jsx
//
// "Uw bestellingen" on the booking form, in "De zending": one card per
// store the customer bought from. Each card has
//   - the store: a dropdown of the webshops on the site (managed in
//     Dashboard -> Shops), plus "Andere winkel" with a box for its name
//   - what they bought there (required: it becomes the contents line customs
//     reads - see backend bookings/views.py)
//   - a screenshot of the order (optional, one per store)
// and "+ Nog een winkel toevoegen" adds another card, up to MAX_ORDERS.
//
// Nothing is uploaded here: the rows and their screenshots are kept in the
// form and sent together with it (src/api/booking.js submitBooking). The
// rules - what is required, which files are allowed - are in orders.js.

import { useEffect, useState } from 'react';
import { listShops } from '../../api/shops';
import { fill } from '../../i18n/fill';
import { MAX_ORDERS, SCREENSHOT, newRow, screenshotProblem } from './orders';
import styles from './Booking.module.css';

const MEGABYTE = 1024 * 1024;

/** "1,2 MB" / "350 kB". */
function formatSize(bytes, language) {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return bytes >= MEGABYTE
    ? `${number.format(bytes / MEGABYTE)} MB`
    : `${number.format(Math.max(1, Math.round(bytes / 1024)))} kB`;
}

/** The screenshot part of one card: a button, or the chosen file. */
function Screenshot({ row, index, onFile, t, language }) {
  const [problem, setProblem] = useState(null);
  const inputId = `order-${row.key}-screenshot`;

  // A preview of a chosen picture, read into a data: address. (Not
  // URL.createObjectURL: React runs effects twice in development, and the
  // clean-up that released the address left a broken image behind.)
  const [read, setRead] = useState(null);
  useEffect(() => {
    if (!row.file?.type.startsWith('image/')) return undefined;
    let live = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (live) setRead({ file: row.file, url: reader.result });
    };
    reader.readAsDataURL(row.file);
    return () => {
      live = false;
    };
  }, [row.file]);
  // Only the preview of the file chosen now, never a stale one.
  const preview = read?.file === row.file ? read.url : null;

  if (row.file) {
    return (
      <div className={styles.attachment}>
        {preview ? (
          <img src={preview} alt="" className={styles.attachmentThumb} />
        ) : (
          <span className={styles.attachmentFile} aria-hidden="true">
            PDF
          </span>
        )}
        <span className={styles.attachmentText}>
          <span className={styles.attachmentName}>{row.file.name}</span>
          <span className={styles.attachmentSize}>{formatSize(row.file.size, language)}</span>
        </span>
        <button
          type="button"
          className={styles.attachmentRemove}
          onClick={() => onFile(null)}
          aria-label={fill(t('booking.orders.removeScreenshot'), { name: row.file.name })}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <>
      <label htmlFor={inputId} className={styles.screenshotButton}>
        <svg viewBox="0 0 24 24" className={styles.dropIcon} aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="m4 17 5-4.5 3.5 3 3-2.5L20 17" />
        </svg>
        {t('booking.orders.addScreenshot')}
        <input
          id={inputId}
          type="file"
          accept={SCREENSHOT.extensions.join(',')}
          className={styles.srOnly}
          aria-label={fill(t('booking.orders.screenshotFor'), { number: index + 1 })}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared, so choosing the same file again still counts.
            event.target.value = '';
            if (!file) return;
            const key = screenshotProblem(file);
            setProblem(key ? fill(t(key), { name: file.name }) : null);
            if (!key) onFile(file);
          }}
        />
      </label>
      {problem && (
        <span className={styles.error} role="alert">
          {problem}
        </span>
      )}
    </>
  );
}

/**
 * @param {object} props
 * @param {object[]} props.rows see orders.js
 * @param {(rows: object[]) => void} props.onChange
 * @param {object} props.errors per row key, from validateOrders
 * @param {string|null} props.serverError the server's reason, if sending failed
 * @param {(key: string) => string} props.t
 * @param {string} props.language
 */
export default function OrdersField({ rows, onChange, errors, serverError, t, language }) {
  const [shops, setShops] = useState([]);

  useEffect(() => {
    let cancelled = false;
    listShops()
      .then((list) => {
        if (!cancelled) setShops(list);
      })
      // Without the list the dropdown still offers "another store", so the
      // form can always be sent.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function update(key, changes) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  return (
    <fieldset className={styles.orders}>
      <legend className={styles.label}>
        {t('booking.orders.title')}
        <span className={styles.required} aria-hidden="true">
          {' '}
          *
        </span>
      </legend>
      <span className={styles.hint}>{t('booking.orders.hint')}</span>

      <ol className={styles.orderList}>
        {rows.map((row, index) => {
          const rowErrors = errors[row.key] ?? {};
          const id = (field) => `order-${row.key}-${field}`;
          return (
            <li key={row.key} className={styles.orderCard}>
              <div className={styles.orderHead}>
                <span className={styles.orderNumber}>
                  {fill(t('booking.orders.store'), { number: index + 1 })}
                </span>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className={styles.orderRemove}
                    onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                  >
                    {t('booking.orders.removeStore')}
                  </button>
                )}
              </div>

              <div className={styles.row}>
                <label className={styles.field} htmlFor={id('shop')}>
                  <span className={styles.label}>{t('booking.orders.shop')}</span>
                  <select
                    id={id('shop')}
                    className={styles.input}
                    value={row.shop}
                    onChange={(event) => update(row.key, { shop: event.target.value })}
                    aria-invalid={Boolean(rowErrors.shop)}
                  >
                    <option value="">{t('booking.orders.choose')}</option>
                    {shops.map((shop) => (
                      <option key={shop.id} value={String(shop.id)}>
                        {shop.name}
                      </option>
                    ))}
                    <option value="other">{t('booking.orders.other')}</option>
                  </select>
                  {rowErrors.shop && <span className={styles.error}>{t(rowErrors.shop)}</span>}
                </label>

                {row.shop === 'other' && (
                  <label className={styles.field} htmlFor={id('name')}>
                    <span className={styles.label}>{t('booking.orders.otherName')}</span>
                    <input
                      id={id('name')}
                      className={styles.input}
                      value={row.shopName}
                      maxLength={80}
                      onChange={(event) => update(row.key, { shopName: event.target.value })}
                      aria-invalid={Boolean(rowErrors.shopName)}
                    />
                    {rowErrors.shopName && (
                      <span className={styles.error}>{t(rowErrors.shopName)}</span>
                    )}
                  </label>
                )}
              </div>

              <label className={styles.field} htmlFor={id('description')}>
                <span className={styles.label}>{t('booking.orders.description')}</span>
                <input
                  id={id('description')}
                  className={styles.input}
                  value={row.description}
                  maxLength={255}
                  placeholder={t('booking.orders.descriptionPlaceholder')}
                  onChange={(event) => update(row.key, { description: event.target.value })}
                  aria-invalid={Boolean(rowErrors.description)}
                />
                {rowErrors.description && (
                  <span className={styles.error}>{t(rowErrors.description)}</span>
                )}
              </label>

              <div className={styles.field}>
                <span className={styles.label}>{t('booking.orders.screenshot')}</span>
                <Screenshot
                  row={row}
                  index={index}
                  onFile={(file) => update(row.key, { file })}
                  t={t}
                  language={language}
                />
              </div>
            </li>
          );
        })}
      </ol>

      {rows.length < MAX_ORDERS && (
        <button
          type="button"
          className={styles.orderAdd}
          onClick={() => onChange([...rows, newRow()])}
        >
          + {t('booking.orders.add')}
        </button>
      )}

      {serverError && (
        <span className={styles.error} role="alert">
          {serverError}
        </span>
      )}
    </fieldset>
  );
}
