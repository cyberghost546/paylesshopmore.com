// src/pages/Dashboard/BookingWarehouseMeasurements.jsx
//
// "WAREHOUSE MEASUREMENTS" on a booking in the office dashboard.
//
// When a warehouse worker measures the goods of a booking, the office sees it
// here without having to go and look in the warehouse screens. The data comes
// from the booking itself (`booking.warehouse`, built on the server by
// bookings/serializers.py -> _warehouse) and has two parts:
//
//   intake_sheets  the intake sheet filled in when the goods arrived: one
//                  line per kind of item ("2 boxes, 60 x 40 x 40 cm, 12,5 kg
//                  each") and what the sheet adds up to.
//   package        weighing and measuring on the scanner. Each re-measure is
//                  a new row; the newest (`current: true`) is the one that
//                  counts, the older ones are kept as history.
//   stage          where the shipment is on the warehouse floor ("Measured",
//                  "Packaged", "Ready for shipping"), once there is one.
//   photos         the photos the workers took - the same ones the customer
//                  sees under "My shipments" on their profile page.
//
// Read-only: the warehouse writes these; the office only reads them here.

import { Link } from 'react-router-dom';
import { apiUrl } from '../../api/client';
import StoredPhoto from '../../components/StoredPhoto/StoredPhoto';
import { Chip, Field, Group } from './sheet';
import { formatDateTime } from './format';
import { number, sizes } from './bookingMeasurements';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

/** One scanner measurement as a sentence. */
function ScannerLine({ row }) {
  const d = usePageText('bookingWarehouse');
  return (
    <>
      <strong>{number(row.weight_kg)} kg</strong> · {sizes(row)} · {number(row.volume_m3)} m³ · {d('volumeWeight')}{' '}
      {number(row.dimensional_weight_kg)} kg
      <span className={styles.mutedCell}>
        {' '}
        — {row.measured_by}, {formatDateTime(row.measured_at)}
      </span>
    </>
  );
}

/** One intake sheet: its lines in a small table, and its totals. */
function IntakeSheet({ sheet }) {
  const d = usePageText('bookingWarehouse');
  const { totals } = sheet;
  const released = sheet.status === 'released';

  return (
    <Field
      wide
      label={
        <>
          {d('intakeSheet', { label: sheet.label })}{' '}
          <Chip tone={released ? 'good' : 'off'}>{released ? d('released') : d('draft')}</Chip>
        </>
      }
    >
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{d('colQty')}</th>
              <th scope="col">{d('colPackaging')}</th>
              <th scope="col">{d('colSizes')}</th>
              <th scope="col">{d('colWeight')}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((line, index) => (
              // Lines have no id of their own in this answer; their order is fixed,
              // so the position is a stable key.
              <tr key={index}>
                <td>{line.quantity}</td>
                <td>{line.packaging || '—'}</td>
                <td>
                  {sizes(line)}
                  {!line.complete && (
                    <>
                      {' '}
                      <Chip tone="off">{d('incomplete')}</Chip>
                    </>
                  )}
                </td>
                <td>{line.weight_kg ? `${number(line.weight_kg)} kg` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.mutedCell} style={{ marginTop: '0.5rem' }}>
        {d('total')}: {totals.colli ?? 0} {d('colli')} · {totals.volume_m3 ? `${number(totals.volume_m3)} m³` : '— m³'} ·{' '}
        {totals.weight_kg ? `${number(totals.weight_kg)} kg` : '— kg'}
        {totals.chargeable_weight_kg && ` · ${d('chargeable')} ${number(totals.chargeable_weight_kg)} kg`}
        {sheet.created_by && ` — ${sheet.created_by}`}
        {`, ${formatDateTime(sheet.released_at ?? sheet.created_at)}`}{' '}
        <Link className={styles.link} to={`/warehouse/intake?sheet=${sheet.id}`}>
          {d('openSheet')}
        </Link>
      </p>
    </Field>
  );
}

export default function BookingWarehouseMeasurements({ warehouse }) {
  const d = usePageText('bookingWarehouse');
  const sheets = warehouse?.intake_sheets ?? [];
  const scans = warehouse?.package ?? [];
  const current = scans.find((row) => row.current);
  const earlier = scans.filter((row) => !row.current);
  const photos = warehouse?.photos ?? [];
  const stage = warehouse?.stage;

  return (
    <Group title={d('group')}>
      {/* No stage means the booking is not confirmed yet, so the warehouse
          has not been told about it: confirming it is what sends it there. */}
      <Field label={d('stage')}>
        {stage ? (
          <Chip tone="good">{stage.label}</Chip>
        ) : (
          <Chip tone="off">{d('notSent')}</Chip>
        )}
      </Field>

      {sheets.length === 0 && scans.length === 0 && (
        <Field label={d('measuredBy')} wide>
          <Chip tone="off">{d('notMeasured')}</Chip>
        </Field>
      )}

      {current && (
        <Field label={d('scanner')} wide>
          <ScannerLine row={current} />
          {earlier.length > 0 && (
            <details style={{ marginTop: '0.4rem' }}>
              <summary className={styles.mutedCell}>{d('earlier', { count: earlier.length })}</summary>
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                {earlier.map((row) => (
                  <li key={row.measured_at}>
                    <ScannerLine row={row} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Field>
      )}

      {sheets.map((sheet) => (
        <IntakeSheet key={sheet.id} sheet={sheet} />
      ))}

      <Field label={d('photos', { count: photos.length })} wide>
        {photos.length === 0 ? (
          <Chip tone="off">{d('noPhotos')}</Chip>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {photos.map((photo, index) => (
              // apiUrl(): the photo is streamed by the API (staff only), so
              // the session cookie goes with the request.
              <a key={photo.id} href={apiUrl(photo.url)} target="_blank" rel="noopener noreferrer">
                <StoredPhoto
                  src={apiUrl(photo.url)}
                  alt={d('photoAlt', { number: index + 1 })}
                  style={{ width: '7rem', height: '7rem', objectFit: 'cover', borderRadius: '8px' }}
                />
              </a>
            ))}
          </div>
        )}
      </Field>
    </Group>
  );
}
