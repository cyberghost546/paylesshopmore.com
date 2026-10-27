// src/pages/Dashboard/invoice/LookupSection.jsx
//
// STEP 1 OF THE FORM: WHICH CUSTOMER AND WHICH SHIPMENT?
//
// Three searchable boxes, all ending in the same place - one shipment:
//
//   Klant / relatienummer  narrows the two shipment boxes to that customer
//   Zendingsnummer         finds a shipment by the office's number (CIT-SE-...)
//   Ordernummer            finds a shipment by its tracking/order number
//
// Picking a shipment calls `onPickShipment`, and the editor fills the rest of
// the form from it. The server checks again on save that the shipment really
// belongs to the customer - the lists here are a convenience, not security.

import { useCallback } from 'react';
import { request } from '../../../api/client';
import { listCustomers, listPackages } from '../../../api/staff';
import { SearchSelect } from './ui';
import { useInvoiceText } from './useInvoiceText';

// Relation numbers are written PLSM + the customer's number: PLSM0012 -> 12.
const RELATION_NUMBER = /^PLSM0*(\d{1,9})$/i;

/** One line in a shipment dropdown. `tr` is the translation function. */
function shipmentRow(row, tr) {
  return (
    <>
      <strong>{row.tracking_number}</strong>
      {` · ${row.customer?.name ?? ''}`}
      {row.description ? ` · ${row.description.slice(0, 60)}` : ''}
      {row.invoice ? ` · ${tr('lookup.hasInvoice', { status: tr(`status.${row.invoice.status}`) })}` : ''}
    </>
  );
}

/**
 * @param {{ form: object, onPickCustomer: (c: object) => void,
 *           onPickShipment: (p: object) => void, disabled: boolean,
 *           error?: string }} props
 */
export default function LookupSection({ form, onPickCustomer, onPickShipment, disabled, error }) {
  const tr = useInvoiceText();
  // useCallback keeps these functions the same between renders, so
  // SearchSelect does not search again every time the editor re-renders.
  const searchCustomers = useCallback(async (text) => {
    const relation = RELATION_NUMBER.exec(text.trim());
    if (relation) {
      // A relation number names exactly one customer: fetch that one.
      try {
        return [await request(`/staff/customers/${relation[1]}/`)];
      } catch {
        return [];
      }
    }
    const page = await listCustomers({ search: text, erased: 'false', page_size: 15 });
    return page.results;
  }, []);

  const customerId = form.customer?.id;
  const searchShipments = useCallback(
    async (text) => {
      const page = await listPackages({ search: text, user: customerId ?? '', page_size: 15 });
      return page.results;
    },
    [customerId],
  );

  return (
    <section aria-labelledby="lookup-title" className="mb-4">
      <h2 id="lookup-title" className="invoice-section-title">
        {tr('lookup.title')}
      </h2>

      {form.customer && (
        <div className="alert alert-light border py-2 small mb-3" role="status">
          <strong>{tr('lookup.customer')}:</strong> {form.customer.name}
          {form.package && (
            <>
              {' · '}
              <strong>{tr('lookup.shipment')}:</strong> {form.order_number || form.package}
            </>
          )}
        </div>
      )}
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {/* Once an invoice is saved its shipment is fixed, so the boxes go. */}
      {!form.invoiceId && (
        <div className="row g-3">
          <div className="col-md-4">
            <SearchSelect
              label={tr('lookup.customerLabel')}
              placeholder={tr('lookup.customerPlaceholder')}
              search={searchCustomers}
              renderRow={(row) => (
                <>
                  <strong>{row.name || row.username}</strong> · {row.email} · PLSM
                  {String(row.id).padStart(4, '0')}
                </>
              )}
              onPick={onPickCustomer}
              disabled={disabled}
            />
          </div>
          <div className="col-md-4">
            <SearchSelect
              label={tr('lookup.shipmentLabel')}
              placeholder={tr('lookup.shipmentPlaceholder')}
              search={searchShipments}
              renderRow={(row) => shipmentRow(row, tr)}
              onPick={onPickShipment}
              disabled={disabled}
            />
          </div>
          <div className="col-md-4">
            <SearchSelect
              label={tr('lookup.orderLabel')}
              placeholder={tr('lookup.orderPlaceholder')}
              search={searchShipments}
              renderRow={(row) => shipmentRow(row, tr)}
              onPick={onPickShipment}
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </section>
  );
}
