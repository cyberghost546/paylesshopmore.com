// src/pages/Warehouse/ShipmentLabel.jsx
//
// A printable label for one shipment. From the top:
//   - a barcode (Code 128) of the tracking number, for handheld scanners;
//   - the number itself, large enough to read and type if the label is torn;
//   - who and where it goes, sea or air - with a QR code of the same number
//     beside it at the bottom, for phones and the warehouse app's camera
//     scanner.
// Sized for a 4.09 × 6.3 inch sticker (Warehouse.module.css, .label), and
// fine on A4.
//
// Both codes hold the tracking number and nothing else, so the scanner's
// lookup finds it and a phone's own camera app shows nothing private.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /warehouse/shipments/:id/label  (printed without the warehouse shell)
//   Who can open: warehouse workers and office staff
//   Links to:     /warehouse/packages/:id ("Back")
//   Linked from:  Package page, the office Packages page
//   Backend:      api/staff.js

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getWarehouseShipment } from '../../api/staff';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { code128Svg } from '../../labels/code128';
import styles from './Warehouse.module.css';

export default function ShipmentLabel() {
  const { id } = useParams();
  const qrRef = useRef(null);
  const [answer, setAnswer] = useState({ id: null, status: 'loading', data: null });

  useEffect(() => {
    let cancelled = false;
    getWarehouseShipment(id)
      .then((data) => !cancelled && setAnswer({ id, status: 'ready', data }))
      .catch(() => !cancelled && setAnswer({ id, status: 'error', data: null }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const state = answer.id === id ? answer.status : 'loading';
  const shipment = answer.data;
  const code = state === 'ready' ? shipment.tracking_number : null;

  // The barcode, as SVG markup made by our own code from the tracking number
  // (src/labels/code128.js). null for a number Code 128 cannot hold (an
  // accented letter) - the QR code and the printed number still work then.
  const barcode = useMemo(() => {
    if (!code) return null;
    try {
      return code128Svg(code);
    } catch {
      return null;
    }
  }, [code]);

  // Drawn into the DOM rather than rendered by React: zxing hands back an SVG
  // element, and the library is loaded only on this page.
  useEffect(() => {
    if (!code || !qrRef.current) return undefined;
    let cancelled = false;
    const target = qrRef.current;

    import('@zxing/browser').then(({ BrowserQRCodeSvgWriter }) => {
      if (cancelled) return;
      const svg = new BrowserQRCodeSvgWriter().write(code, 300, 300);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `QR code for ${code}`);
      target.replaceChildren(svg);
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state === 'loading') return <Loading />;
  if (state === 'error') return <ConnectionError />;

  const colli = shipment.intake?.colli;

  return (
    <div className={styles.labelPage}>
      <div className={styles.labelToolbar}>
        <Link to={`/warehouse/packages/${shipment.id}`} className={styles.plainButton}>
          ← Back
        </Link>
        <button type="button" className={styles.printButton} onClick={() => window.print()}>
          Print label
        </button>
      </div>

      <section className={styles.label} aria-label="Shipping label">
        <p className={styles.labelBrand}>PayLesShopMore.com</p>
        {barcode && (
          <div
            className={styles.labelBarcode}
            role="img"
            aria-label={`Barcode for ${shipment.tracking_number}`}
            // Safe: built by code128Svg from the tracking number, which it
            // only accepts as plain printable characters.
            dangerouslySetInnerHTML={{ __html: barcode }}
          />
        )}
        <p className={styles.labelCode}>{shipment.tracking_number}</p>

        {/* The details on the left, the QR code on the right, level with
            the bottom of the details. */}
        <div className={styles.labelBody}>
          <dl className={styles.labelFacts}>
            <div>
              <dt>To</dt>
              <dd>
                {shipment.customer}
                {shipment.delivery_address_text && <br />}
                {shipment.delivery_address_text}
              </dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd className={styles.labelBig}>{shipment.destination || '—'}</dd>
            </div>
            {(shipment.freight_display || shipment.intake?.freight_display) && (
              <div>
                <dt>Method</dt>
                {/* As big as the destination: sea or air decides which pile the
                    box goes on, so it must be readable from across the floor. */}
                <dd className={styles.labelBig}>
                  {shipment.freight_display || shipment.intake.freight_display}
                </dd>
              </div>
            )}
            {shipment.measurement && (
              <div>
                <dt>Weight</dt>
                <dd>
                  {Number(shipment.measurement.weight_kg)} kg · {Number(shipment.measurement.length_cm)} ×{' '}
                  {Number(shipment.measurement.width_cm)} × {Number(shipment.measurement.height_cm)} cm
                </dd>
              </div>
            )}
            {colli ? (
              <div>
                <dt>Colli</dt>
                <dd>{colli}</dd>
              </div>
            ) : null}
          </dl>
          <div ref={qrRef} className={styles.labelQr} />
        </div>
      </section>
    </div>
  );
}
