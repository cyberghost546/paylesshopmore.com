// src/pages/Profile/TrackedOrder.jsx
//
// Everything about one order, shown under the Track & Trace box on the
// profile page once the customer has looked up a number. The box on the
// homepage stays short; on the profile the customer is signed in and looking
// at their own order, so they get all of it here:
//
//   Our number (PLSM-...)            Courier's number (PostNL, DHL, ...)
//   ---------------------            -----------------------------------
//   1. booking: number and date      1. which order it is, and which of
//   2. the full shipment, exactly       our shipments it travels in
//      as "My shipments" shows it    2. the courier tracking itself
//      (timeline, facts, invoice,
//      photos, delivery or pickup)
//   3. the webshop orders in it,
//      each with its courier tracking
//   4. the courier taking it to the
//      island, when it travels with one
//
// The lookup itself (TrackingView in backend/accounts/public.py) only ever
// finds the signed-in customer's own shipments.

import { useEffect, useState } from 'react';
import { listPackages } from '../../api/profile';
import OrderList from '../../components/AttachmentList/OrderList';
import CourierTracking from '../../components/CourierTracking/CourierTracking';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import ShipmentDetails from './ShipmentDetails';
import styles from './Profile.module.css';
import { lockText } from './shipmentLock';

/**
 * @param {object} props
 * @param {object} props.result    what the tracking lookup answered; `kind` is
 *   "shipment" (one of our PLSM numbers) or "courier" (a courier's number)
 * @param {object[]} [props.invoices]  the customer's invoices, already loaded
 *   by the profile page; the shipment shows its own
 */
export default function TrackedOrder({ result, invoices = [] }) {
  const { t, language } = useLanguage();
  const d = (key, values) => fill(t(`tracking.details.${key}`), values);
  const dateFormat = new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (result.kind === 'courier') {
    return (
      <div className={styles.trackedOrder}>
        {/* An outgoing number is one of our shipments: no webshop order. */}
        {result.shop_name && (
          <p className={styles.trackedOrderLine}>
            {d('courierOrder', { shop: result.shop_name, description: result.order_description })}
          </p>
        )}
        {/* Once the warehouse has packed it into one of our shipments. */}
        {result.package_tracking_number && (
          <p className={styles.trackedOrderLine}>
            {d('inShipment', { number: result.package_tracking_number })}
          </p>
        )}
        <CourierTracking tracking={result} />
      </div>
    );
  }

  return <OurShipment result={result} invoices={invoices} d={d} dateFormat={dateFormat} />;
}

/** One of our own shipments (PLSM-...): the booking, the shipment, its orders. */
function OurShipment({ result, invoices, d, dateFormat }) {
  const { t } = useLanguage();
  // The full shipment as "My shipments" has it. Found by tracking number in
  // the customer's own list - the same request that section makes.
  const [shipment, setShipment] = useState(null);
  // 'loading' | 'ready' | 'failed'
  const [state, setState] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    listPackages().then(
      (rows) => {
        if (cancelled) return;
        const wanted = result.tracking_number.toLowerCase();
        setShipment(rows.find((row) => row.tracking_number.toLowerCase() === wanted) ?? null);
        setState('ready');
      },
      () => !cancelled && setState('failed'),
    );
    return () => {
      cancelled = true;
    };
  }, [result.tracking_number]);

  return (
    <div className={styles.trackedOrder}>
      {result.booking && (
        <p className={styles.trackedOrderLine}>
          {d('booked', {
            number: result.booking.shipping_number || '—',
            date: dateFormat.format(new Date(result.booking.created_at)),
          })}
        </p>
      )}

      {state === 'loading' && <p className={styles.invoiceMessage}>{d('loading')}</p>}
      {state === 'failed' && <p className={styles.invoiceMessage}>{d('failed')}</p>}
      {state === 'ready' && shipment && (
        <ShipmentDetails
          shipment={shipment}
          invoices={invoices}
          dateFormat={dateFormat}
          lock={lockText(shipment)}
          // The customer chose delivery or pickup here: show the new copy.
          onUpdated={setShipment}
        />
      )}

      {result.orders?.length > 0 && (
        <>
          <h3 className={styles.trackedOrderTitle}>{d('ordersTitle')}</h3>
          <OrderList
            orders={result.orders}
            kindLabel={(document) => t(`profile.bookings.documents.kinds.${document.kind}`)}
          />
        </>
      )}

      {result.onward_trackings?.length > 0 && (
        <>
          <h3 className={styles.trackedOrderTitle}>{d('onwardTitle')}</h3>
          {result.onward_trackings.map((tracking) => (
            <CourierTracking key={tracking.id} tracking={tracking} />
          ))}
        </>
      )}
    </div>
  );
}
