// src/pages/Profile/prealertStatus.js
//
// One rule for what a pre-alert's status is called, shared by the customer's
// list (PreAlerts.jsx) and the office's page (Dashboard/PreAlerts.jsx).

/**
 * What to call where a pre-alert is, as a translation key and a tone.
 * The pre-alert's own status first (cancelled, in a shipment, arrived); while
 * it is on its way, the courier's latest status - or "submitted" when the
 * courier has said nothing yet.
 */
export function prealertStatus(prealert) {
  if (prealert.status === 'cancelled') return { key: 'prealert.status.cancelled', tone: 'off' };
  if (prealert.status === 'in_shipment') return { key: 'prealert.status.in_shipment', tone: 'done' };
  if (prealert.status === 'arrived') return { key: 'prealert.status.arrived', tone: 'done' };
  const courier = prealert.carrier_tracking?.status;
  if (courier && courier !== 'order_registered') {
    return { key: `courier.status.${courier}`, tone: prealert.carrier_tracking?.problem ? 'problem' : 'moving' };
  }
  return { key: 'prealert.status.submitted', tone: 'waiting' };
}
