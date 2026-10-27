// src/pages/Dashboard/CourierTracking.jsx
//
// Courier tracking in the back office: every courier tracking number we
// follow, in two stages:
//   incoming  a webshop order on its way to our warehouse (the number the
//             customer gave, or one our team registered);
//   outgoing  one of our shipments on its way to the island with an outside
//             courier.
//
// HOW THE PAGE WORKS
//   - The table lists the shipments, newest change first. Search by tracking
//     number, customer, shop or our own PLSM number; filter by status, or
//     show only the ones with a problem (failed delivery, delay, returned),
//     or only one stage.
//   - "Register a number" (office): find the customer, pick the order,
//     pre-alert or shipment, the courier and the number.
//   - Clicking a row opens it below the table:
//       * the same view the customer sees (CourierTracking), so staff know
//         exactly what the customer is reading;
//       * "Add an update": a line typed by us. It is always marked "Our team",
//         never as courier data. "Delivered" asks how it was confirmed.
//       * every line ever shown, with who added it, and "Correct" to hide a
//         wrong one from the customer. Nothing is deleted: the line and the
//         reason stay on record.
//       * the courier, the expected delivery date and "Check now" (ask the
//         courier immediately instead of waiting for the automatic check).
//       * "Correct the number": a wrong number or courier is replaced; the
//         old one, who changed it and why stay on record (history below it).
//
// WHO CAN DO WHAT (the server checks it; the page only avoids offering
// buttons that would be refused)
//   office and admins:  everything
//   warehouse manager:  read and add updates
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/courier-tracking
//   Who can open: office staff, warehouse manager
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js (listCarrierShipments ...), backend/tracking/

import { useCallback, useEffect, useState } from 'react';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import CourierTracking from '../../components/CourierTracking/CourierTracking';
import Loading from '../../components/Loading/Loading';
import {
  addCarrierEvent,
  correctCarrierNumber,
  createCarrierShipment,
  getCarrierShipment,
  listCarrierShipments,
  lookupTrackingCustomers,
  refreshCarrierShipment,
  updateCarrierShipment,
  voidCarrierEvent,
} from '../../api/staff';
import { getCarriers } from '../../api/tracking';
import { useAuth } from '../../auth/useAuth';
import { useLanguage } from '../../i18n/useLanguage';
import { isManagerOnly } from './managerAccess';
import { Banner, Empty, FilterSelect, Pagination, SearchInput, StatusBadge, Toolbar } from './ui';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

// The statuses, in the order of the journey (backend/tracking/statuses.py).
const STATUSES = [
  'order_registered',
  'awaiting_arrival',
  'dispatched',
  'in_transit',
  'arrived_at_destination',
  'customs',
  'out_for_delivery',
  'delivered',
  'received_at_warehouse',
  'processing_at_warehouse',
  'ready_for_shipment',
  'delivery_failed',
  'delayed',
  'returned',
  'exception',
];
const PROBLEMS = new Set(['delivery_failed', 'delayed', 'returned', 'exception']);
const STAGES = ['incoming', 'outgoing'];

/** The first message from a refused request, for a banner. */
function firstError(error, fallback) {
  const fields = error?.fields ?? error?.data ?? {};
  for (const value of Object.values(fields)) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return fallback;
}

/** A date and time in the dashboard language, or a dash. */
function useDateTime() {
  const { language } = useLanguage();
  return (value) =>
    value
      ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
      : '—';
}

export default function CourierTrackingPage() {
  const d = usePageText('courierTracking');
  const { t } = useLanguage();
  const when = useDateTime();
  const { language } = useLanguage();
  // A date without a time ("2026-10-22"), or a dash.
  const day = (value) =>
    value ? new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`)) : '—';
  const statusLabel = (value) => t(`courier.status.${value}`);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ results: [], count: 0 });
  const [state, setState] = useState('loading');
  const [selectedId, setSelectedId] = useState(null);
  // The "Register a number" form, open or not (office only).
  const [registering, setRegistering] = useState(false);
  const { user } = useAuth();
  const office = !isManagerOnly(user);

  const load = useCallback(async () => {
    try {
      setList(
        await listCarrierShipments({ search, status, stage, problems: problemsOnly ? '1' : '', page }),
      );
      setState('ready');
    } catch {
      setState('failed');
    }
  }, [search, status, stage, problemsOnly, page]);

  // Debounced, so typing a number is one request rather than one per key.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'failed') return <ConnectionError onRetry={load} />;

  return (
    <>
      <header className={styles.head} data-tour="db-courier-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Toolbar tour="db-courier-filters">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          label={d('status')}
          options={STATUSES.map((value) => ({ value, label: statusLabel(value) }))}
        />
        <FilterSelect
          value={stage}
          onChange={(value) => {
            setStage(value);
            setPage(1);
          }}
          label={d('stage')}
          options={STAGES.map((value) => ({ value, label: d(`stage_${value}`) }))}
        />
        <label className={styles.filter}>
          <input
            type="checkbox"
            checked={problemsOnly}
            onChange={(event) => {
              setProblemsOnly(event.target.checked);
              setPage(1);
            }}
          />{' '}
          {d('problemsOnly')}
        </label>
        {office && (
          <button
            type="button"
            className={styles.rowButton}
            onClick={() => setRegistering((open) => !open)}
            aria-expanded={registering}
          >
            {d('registerOpen')}
          </button>
        )}
      </Toolbar>

      {registering && (
        <RegisterNumber
          onCreated={(row) => {
            setRegistering(false);
            setSelectedId(row.id);
            load();
          }}
        />
      )}

      {list.results.length === 0 ? (
        <Empty>{d('empty')}</Empty>
      ) : (
        <div className={styles.tableWrap} data-tour="db-courier-table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{d('colNumber')}</th>
                <th scope="col">{d('stage')}</th>
                <th scope="col">{d('colCarrier')}</th>
                <th scope="col">{d('colCustomer')}</th>
                <th scope="col">{d('colShop')}</th>
                <th scope="col">{d('status')}</th>
                <th scope="col">{d('expected')}</th>
                <th scope="col">{d('colUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {list.results.map((row) => (
                <tr key={row.id} className={row.id === selectedId ? styles.rowBusy : undefined}>
                  <td>
                    {/* A button, so the row opens from the keyboard too. */}
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setSelectedId(row.id === selectedId ? null : row.id)}
                      aria-expanded={row.id === selectedId}
                    >
                      {row.tracking_number}
                    </button>
                  </td>
                  <td>{d(`stage_${row.stage}`)}</td>
                  <td>{row.carrier?.name ?? '—'}</td>
                  <td>{row.customer_name ?? '—'}</td>
                  <td>{row.shop_name || row.reference || '—'}</td>
                  <td>
                    <StatusBadge tone={PROBLEMS.has(row.status) ? 'attention' : 'neutral'}>
                      {statusLabel(row.status)}
                    </StatusBadge>
                  </td>
                  <td>{day(row.estimated_delivery)}</td>
                  <td>{when(row.last_synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        count={list.count}
        hasNext={list.hasNext}
        hasPrevious={list.hasPrevious}
        onChange={setPage}
      />

      {selectedId && (
        <ShipmentDetail key={selectedId} id={selectedId} onChanged={load} />
      )}
    </>
  );
}

/** One shipment, opened below the table. */
function ShipmentDetail({ id, onChanged }) {
  const d = usePageText('courierTracking');
  const { t } = useLanguage();
  const { user } = useAuth();
  const when = useDateTime();
  // The warehouse manager reads and adds; correcting is for the office.
  const office = !isManagerOnly(user);

  const [shipment, setShipment] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [message, setMessage] = useState({ tone: 'info', text: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCarrierShipment(id).then(
      (data) => !cancelled && setShipment(data),
      () => !cancelled && setMessage({ tone: 'error', text: d('loadFailed') }),
    );
    getCarriers().then((list) => !cancelled && setCarriers(list), () => {});
    return () => {
      cancelled = true;
    };
  }, [id, d]);

  /** Run one change; show the shipment as the server now has it. */
  async function run(action, done) {
    setBusy(true);
    setMessage({ tone: 'info', text: '' });
    try {
      setShipment(await action());
      setMessage({ tone: 'success', text: done });
      onChanged();
      return true;
    } catch (error) {
      setMessage({ tone: 'error', text: firstError(error, d('saveFailed')) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!shipment) {
    return message.text ? <Banner tone="error">{message.text}</Banner> : <Loading />;
  }

  // What the customer sees: the same object without the corrected lines.
  const customerView = {
    ...shipment,
    events: shipment.events.filter((event) => !event.voided_at),
  };

  return (
    <section className={styles.officeBox} aria-label={d('detailTitle')}>
      <p className={styles.officeHead}>
        {d('detailTitle')}: {shipment.tracking_number}
      </p>
      <p className={styles.officeNote}>
        {d('detailFor', {
          customer: shipment.customer_name ?? '—',
          email: shipment.customer_email ?? '—',
          shop: shipment.shop_name,
          order: shipment.order_description,
        })}
        {shipment.package_tracking_number &&
          ` ${d('ourNumber', { number: shipment.package_tracking_number })}`}
      </p>
      <p className={styles.officeNote}>
        {d(`stage_${shipment.stage}`)} ·{' '}
        {shipment.entered_by_customer
          ? d('enteredByCustomer')
          : d('enteredBy', { name: shipment.entered_by_name ?? '—' })}
      </p>

      <Banner tone={message.tone}>{message.text}</Banner>

      {/* Why automatic updates are not arriving, when they are not. */}
      {shipment.last_sync_error && (
        <Banner tone="error">{d('syncError', { error: shipment.last_sync_error })}</Banner>
      )}

      <h2 className={styles.officeHead}>{d('customerSees')}</h2>
      <CourierTracking tracking={customerView} />

      <AddUpdate
        busy={busy}
        onAdd={(line) => run(() => addCarrierEvent(id, line), d('added'))}
      />

      {office && (
        <div className={styles.officeGrid}>
          <label className={styles.officeField}>
            <span className={styles.officeLabel}>{d('carrier')}</span>
            <select
              className={styles.officeInput}
              value={shipment.carrier?.code ?? ''}
              disabled={busy}
              onChange={(event) =>
                run(() => updateCarrierShipment(id, { carrier: event.target.value }), d('saved'))
              }
            >
              <option value="">{d('noCarrier')}</option>
              {carriers.map((carrier) => (
                <option key={carrier.code} value={carrier.code}>
                  {carrier.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.officeField}>
            <span className={styles.officeLabel}>{d('expected')}</span>
            <input
              className={styles.officeInput}
              type="date"
              defaultValue={shipment.estimated_delivery ?? ''}
              disabled={busy}
              onBlur={(event) => {
                const value = event.target.value || null;
                if (value === (shipment.estimated_delivery ?? null)) return;
                run(() => updateCarrierShipment(id, { estimated_delivery: value }), d('saved'));
              }}
            />
          </label>
          <div className={styles.officeField}>
            <span className={styles.officeLabel}>{d('automatic')}</span>
            <button
              type="button"
              className={styles.rowButton}
              disabled={busy}
              onClick={() => run(() => refreshCarrierShipment(id), d('checked'))}
            >
              {d('checkNow')}
            </button>
            <span className={styles.officeNote}>
              {d('nextCheck', { when: when(shipment.next_sync_at) })}
            </span>
          </div>
        </div>
      )}

      {office && (
        <CorrectNumber
          shipment={shipment}
          carriers={carriers}
          busy={busy}
          onCorrect={(body) => run(() => correctCarrierNumber(id, body), d('corrected'))}
        />
      )}

      {shipment.number_changes?.length > 0 && (
        <>
          <h2 className={styles.officeHead}>{d('changesTitle')}</h2>
          <ul className={styles.officeNote}>
            {shipment.number_changes.map((change) => (
              <li key={`${change.changed_at}-${change.new_tracking_number}`}>
                {d('changeLine', {
                  when: when(change.changed_at),
                  name: change.changed_by ?? '—',
                  from: `${change.old_carrier ?? '—'} ${change.old_tracking_number}`,
                  to: `${change.new_carrier ?? '—'} ${change.new_tracking_number}`,
                  reason: change.reason,
                })}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className={styles.officeHead}>{d('allLines')}</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{d('colWhen')}</th>
              <th scope="col">{d('status')}</th>
              <th scope="col">{d('colText')}</th>
              <th scope="col">{d('colSource')}</th>
              {office && <th scope="col">{d('colActions')}</th>}
            </tr>
          </thead>
          <tbody>
            {shipment.events.map((event) => (
              <tr key={event.id} className={event.voided_at ? styles.rowBusy : undefined}>
                <td>{when(event.occurred_at)}</td>
                <td>{event.status ? t(`courier.status.${event.status}`) : '—'}</td>
                <td>
                  {[event.description, event.location].filter(Boolean).join(' · ') || '—'}
                  {event.voided_at && (
                    <div className={styles.officeNote}>
                      {d('voidedBy', {
                        name: event.voided_by_name ?? '—',
                        when: when(event.voided_at),
                        reason: event.void_reason,
                      })}
                    </div>
                  )}
                </td>
                <td>
                  {event.source_display}
                  {event.created_by_name ? ` (${event.created_by_name})` : ''}
                </td>
                {office && (
                  <td>
                    {!event.voided_at && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={busy}
                        onClick={() => {
                          // A reason is required: it is what the record keeps.
                          const reason = window.prompt(d('voidReason'));
                          if (!reason?.trim()) return;
                          run(() => voidCarrierEvent(id, event.id, reason.trim()), d('voided'));
                        }}
                      >
                        {d('correct')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The "Add an update" form: a line typed by our staff. */
function AddUpdate({ busy, onAdd }) {
  const d = usePageText('courierTracking');
  const { t } = useLanguage();
  const blank = { status: '', description: '', location: '', occurred_at: '', confirmation: '' };
  const [line, setLine] = useState(blank);
  const set = (field) => (event) => setLine((current) => ({ ...current, [field]: event.target.value }));
  const delivered = line.status === 'delivered';

  async function submit(event) {
    event.preventDefault();
    if (!line.status) return;
    const ok = await onAdd({
      status: line.status,
      description: line.description.trim(),
      location: line.location.trim(),
      // The date-time box gives local time without a zone; the browser's
      // Date turns it into a real moment the server can store.
      occurred_at: line.occurred_at ? new Date(line.occurred_at).toISOString() : null,
      confirmation: line.confirmation.trim(),
    });
    if (ok) setLine(blank);
  }

  return (
    <form className={styles.officeBox} onSubmit={submit} data-tour="db-courier-add">
      <p className={styles.officeHead}>{d('addTitle')}</p>
      <p className={styles.officeNote}>{d('addNote')}</p>
      <div className={styles.officeGrid}>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('newStatus')}</span>
          <select className={styles.officeInput} value={line.status} onChange={set('status')} required>
            <option value="">{d('chooseStatus')}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`courier.status.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('description')}</span>
          <input className={styles.officeInput} value={line.description} onChange={set('description')} maxLength={400} />
        </label>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('location')}</span>
          <input className={styles.officeInput} value={line.location} onChange={set('location')} maxLength={200} />
        </label>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('when')}</span>
          <input
            className={styles.officeInput}
            type="datetime-local"
            value={line.occurred_at}
            onChange={set('occurred_at')}
          />
        </label>
        {/* Only for "Delivered": the server refuses it without one. */}
        {delivered && (
          <label className={styles.officeField}>
            <span className={styles.officeLabel}>{d('confirmation')}</span>
            <input
              className={styles.officeInput}
              value={line.confirmation}
              onChange={set('confirmation')}
              placeholder={d('confirmationPlaceholder')}
              required
              maxLength={300}
            />
          </label>
        )}
      </div>
      <button type="submit" className={styles.rowButton} disabled={busy || !line.status}>
        {d('add')}
      </button>
    </form>
  );
}

/**
 * "Register a number": a courier number for a customer, entered by our team.
 * Find the customer, then what it belongs to: an order or pre-alert coming
 * to our warehouse (incoming), or one of our shipments going to the island
 * (outgoing). The server checks that it is all this customer's.
 */
function RegisterNumber({ onCreated }) {
  const d = usePageText('courierTracking');
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [form, setForm] = useState({ stage: 'incoming', parent: '', carrier: '', number: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  useEffect(() => {
    getCarriers().then(setCarriers, () => {});
  }, []);

  // Debounced customer search, as the table's search box.
  useEffect(() => {
    if (query.trim().length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      lookupTrackingCustomers(query.trim()).then(
        (rows) => !cancelled && setCustomers(rows),
        () => !cancelled && setCustomers([]),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // What the number can hang off, for the chosen stage. "order:12" etc.
  const parents = !customer
    ? []
    : form.stage === 'outgoing'
      ? customer.packages.map((p) => ({ value: `package:${p.id}`, label: `${p.tracking_number} ${p.description}`.trim() }))
      : [
          ...customer.orders.map((o) => ({
            value: `order:${o.id}`,
            label: `${o.shop_name} – ${o.description}${o.reference ? ` (${o.reference})` : ''}`,
          })),
          ...customer.prealerts.map((p) => ({ value: `prealert:${p.id}`, label: `${p.reference} – ${p.shop_name}` })),
        ];

  async function submit(event) {
    event.preventDefault();
    const [kind, parentId] = form.parent.split(':');
    setBusy(true);
    setError('');
    try {
      const row = await createCarrierShipment({
        customer: customer.id,
        stage: form.stage,
        [kind]: Number(parentId),
        carrier: form.carrier,
        tracking_number: form.number.trim(),
      });
      onCreated(row);
    } catch (failure) {
      setError(firstError(failure, d('saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.officeBox} onSubmit={submit} aria-label={d('registerTitle')}>
      <p className={styles.officeHead}>{d('registerTitle')}</p>
      <p className={styles.officeNote}>{d('registerNote')}</p>
      {error && <Banner tone="error">{error}</Banner>}

      {!customer ? (
        <>
          <label className={styles.officeField}>
            <span className={styles.officeLabel}>{d('findCustomer')}</span>
            <input
              className={styles.officeInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={d('findCustomerPlaceholder')}
            />
          </label>
          <ul className={styles.officeNote}>
            {/* Old results are hidden once the search box is (nearly) empty. */}
            {(query.trim().length < 2 ? [] : customers).map((row) => (
              <li key={row.id}>
                <button type="button" className={styles.linkButton} onClick={() => setCustomer(row)}>
                  {[row.customer_code, row.name, row.email].filter(Boolean).join(' · ')}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className={styles.officeNote}>
            {[customer.customer_code, customer.name, customer.email].filter(Boolean).join(' · ')}{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setCustomer(null);
                setForm((current) => ({ ...current, parent: '' }));
              }}
            >
              {d('otherCustomer')}
            </button>
          </p>
          <div className={styles.officeGrid}>
            <label className={styles.officeField}>
              <span className={styles.officeLabel}>{d('stage')}</span>
              <select
                className={styles.officeInput}
                value={form.stage}
                onChange={(event) => setForm((current) => ({ ...current, stage: event.target.value, parent: '' }))}
              >
                {STAGES.map((value) => (
                  <option key={value} value={value}>
                    {d(`stage_${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.officeField}>
              <span className={styles.officeLabel}>
                {form.stage === 'outgoing' ? d('parentPackage') : d('parentOrder')}
              </span>
              <select className={styles.officeInput} value={form.parent} onChange={set('parent')} required>
                <option value="">{parents.length ? d('choose') : d('nothingToChoose')}</option>
                {parents.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.officeField}>
              <span className={styles.officeLabel}>{d('carrier')}</span>
              <select className={styles.officeInput} value={form.carrier} onChange={set('carrier')} required>
                <option value="">{d('choose')}</option>
                {carriers.map((carrier) => (
                  <option key={carrier.code} value={carrier.code}>
                    {carrier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.officeField}>
              <span className={styles.officeLabel}>{d('colNumber')}</span>
              <input className={styles.officeInput} value={form.number} onChange={set('number')} required maxLength={200} />
            </label>
          </div>
          <button
            type="submit"
            className={styles.rowButton}
            disabled={busy || !form.parent || !form.carrier || !form.number.trim()}
          >
            {d('register')}
          </button>
        </>
      )}
    </form>
  );
}

/** "Correct the number": replace a wrong number or courier, with a reason. */
function CorrectNumber({ shipment, carriers, busy, onCorrect }) {
  const d = usePageText('courierTracking');
  const [number, setNumber] = useState(shipment.tracking_number);
  const [carrier, setCarrier] = useState(shipment.carrier?.code ?? '');
  const [reason, setReason] = useState('');

  async function submit(event) {
    event.preventDefault();
    const ok = await onCorrect({ tracking_number: number.trim(), carrier, reason: reason.trim() });
    if (ok) setReason('');
  }

  return (
    <form className={styles.officeBox} onSubmit={submit} aria-label={d('correctTitle')}>
      <p className={styles.officeHead}>{d('correctTitle')}</p>
      <p className={styles.officeNote}>{d('correctNote')}</p>
      <div className={styles.officeGrid}>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('colNumber')}</span>
          <input className={styles.officeInput} value={number} onChange={(event) => setNumber(event.target.value)} required maxLength={200} />
        </label>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('carrier')}</span>
          <select className={styles.officeInput} value={carrier} onChange={(event) => setCarrier(event.target.value)}>
            <option value="">{d('noCarrier')}</option>
            {carriers.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.officeField}>
          <span className={styles.officeLabel}>{d('correctReason')}</span>
          <input className={styles.officeInput} value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={300} />
        </label>
      </div>
      <button type="submit" className={styles.rowButton} disabled={busy || !reason.trim() || !number.trim()}>
        {d('correctSubmit')}
      </button>
    </form>
  );
}
