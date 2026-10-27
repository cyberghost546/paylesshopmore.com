// src/pages/Profile/shipmentLock.js
//
// Which sentence a shipment that can no longer be changed gets. Shared by
// "My shipments" (Shipments.jsx) and the Track & Trace box (TrackedOrder.jsx),
// so the two always say the same thing.

/**
 * The heading and sentence a locked shipment gets, as translation keys, or
 * null when it is not locked.
 *
 * `locked` comes from the server, so this decides only the wording. Which
 * statuses mean "gone" is a rule and lives on the model with the code that
 * enforces it. A delivered or cancelled shipment gets its own heading: "On
 * its way" above "this was delivered" read as a contradiction.
 */
export function lockText(shipment) {
  if (!shipment.locked) return null;
  if (shipment.status === 'delivered') {
    return {
      title: 'profile.shipments.locked.titleDelivered',
      body: 'profile.shipments.locked.delivered',
    };
  }
  if (shipment.status === 'cancelled') {
    return {
      title: 'profile.shipments.locked.titleCancelled',
      body: 'profile.shipments.locked.cancelled',
    };
  }
  return {
    title: 'profile.shipments.locked.title',
    body: 'profile.shipments.locked.body',
  };
}
