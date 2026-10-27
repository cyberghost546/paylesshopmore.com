// src/pages/Dashboard/PreAlerts.jsx
//
// Pre-alerts in the back office: every parcel a customer told us is on its
// way to our warehouse.
//
// HOW THE PAGE WORKS
//   - The table lists them, newest first. Search by our reference (PA-...),
//     the courier's number, the customer, the shop or what is inside; filter
//     by status.
//   - Clicking a reference opens it below the table: the customer, receiver
//     and address, the declared value, the invoice files, the courier's
//     updates, and:
//       * "Add to shipment" (office): put the parcel in one of THE SAME
//         customer's shipments by its PLSM number. The server refuses any
//         other customer's shipment, so a typo cannot move a parcel.
//       * "Cancel" (office): for a parcel that is not coming after all.
//   - Arrival is not set here: the warehouse records it by scanning the
//     courier's barcode (Warehouse -> Scan Package), which is the only proof
//     the parcel is really here.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/prealerts
//   Who can open: office staff, warehouse manager (read only)
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js (listStaffPrealerts ...), backend/prealerts/

import { useCallback, useEffect, useState } from 'react';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import CourierTracking from '../../components/CourierTracking/CourierTracking';
import Loading from '../../components/Loading/Loading';
import { prealertDocumentUrl } from '../../api/prealerts';
import { addPrealertToShipment, cancelStaffPrealert, listStaffPrealerts } from '../../api/staff';
import { useAuth } from '../../auth/useAuth';
import { useLanguage } from '../../i18n/useLanguage';
import { prealertStatus } from '../Profile/prealertStatus';
import { isManagerOnly } from './managerAccess';
import { Banner, Empty, FilterSelect, Pagination, SearchInput, StatusBadge, Toolbar } from './ui';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

const STATUSES = ['submitted', 'arrived', 'in_shipment', 'cancelled'];
const TONES = { waiting: 'attention', moving: 'progress', done: 'done', problem: 'attention', off: 'off' };

/** The first message from a refused request, for a banner. */
function firstError(error, fallback) {
  const fields = error?.fields ?? {};
  for (const value of Object.values(fields)) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return fallback;
}

export default function PreAlertsPage() {
  const d = usePageText('prealerts');
  const { t, language } = useLanguage();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ results: [], count: 0 });
  const [state, setState] = useState('loading');
  const [openId, setOpenId] = useState(null);

  const day = new Intl.DateTimeFormat(language, { dateStyle: 'medium' });

  const load = useCallback(async () => {
    try {
      setList(await listStaffPrealerts({ search, status, page }));
      setState('ready');
    } catch {
      setState('failed');
    }
  }, [search, status, page]);

  // Debounced, so typing is one request rather than one per key.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  if (state === 'loading') return <Loading />;
  if (state === 'failed') return <ConnectionError onRetry={load} />;

  const selected = list.results.find((row) => row.id === openId);

  return (
    <>
      <header className={styles.head} data-tour="db-prealerts-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Toolbar tour="db-prealerts-filters">
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
          options={STATUSES.map((value) => ({ value, label: t(`prealert.status.${value}`) }))}
        />
      </Toolbar>

      {list.results.length === 0 ? (
        <Empty>{d('empty')}</Empty>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{d('colReference')}</th>
                <th scope="col">{d('colCourier')}</th>
                <th scope="col">{d('colCustomer')}</th>
                <th scope="col">{d('colShop')}</th>
                <th scope="col">{d('status')}</th>
                <th scope="col">{d('colSent')}</th>
              </tr>
            </thead>
            <tbody>
              {list.results.map((row) => {
                const shown = prealertStatus(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <button
                        type="button"
                        className={styles.linkButton}
                        onClick={() => setOpenId(row.id === openId ? null : row.id)}
                        aria-expanded={row.id === openId}
                      >
                        {row.reference}
                      </button>
                    </td>
                    <td>
                      {row.carrier.name} {row.tracking_number}
                    </td>
                    <td>{row.customer_name ?? '—'}</td>
                    <td>{row.shop_name}</td>
                    <td>
                      <StatusBadge tone={TONES[shown.tone]}>{t(shown.key)}</StatusBadge>
                    </td>
                    <td>{day.format(new Date(row.created_at))}</td>
                  </tr>
                );
              })}
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

      {selected && <PreAlertDetail key={selected.id} prealert={selected} onChanged={load} />}
    </>
  );
}

/** One pre-alert, opened below the table. */
function PreAlertDetail({ prealert, onChanged }) {
  const d = usePageText('prealerts');
  const { t, language } = useLanguage();
  const { user } = useAuth();
  // The warehouse manager reads; adding to a shipment is for the office.
  const office = !isManagerOnly(user);
  const [current, setCurrent] = useState(prealert);
  const [packageNumber, setPackageNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: 'info', text: '' });

  const money = new Intl.NumberFormat(language, { style: 'currency', currency: current.currency });
  const when = (value) =>
    value ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

  async function run(action, done) {
    setBusy(true);
    setMessage({ tone: 'info', text: '' });
    try {
      setCurrent(await action());
      setMessage({ tone: 'success', text: done });
      onChanged();
    } catch (error) {
      setMessage({ tone: 'error', text: firstError(error, d('saveFailed')) });
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    [d('customer'), `${current.customer_name ?? '—'} (${current.customer_email ?? '—'})`],
    [d('consignee'), [current.consignee_name, current.consignee_address_text].filter(Boolean).join('\n')],
    [d('description'), current.description],
    // Empty for pre-alerts sent since the form stopped asking for it.
    [d('value'), current.declared_value != null ? money.format(Number(current.declared_value)) : '—'],
    [d('restricted'), when(current.restricted_items_confirmed_at)],
    [d('arrived'), current.arrived_at ? `${when(current.arrived_at)} · ${current.arrived_by_name ?? '—'}` : '—'],
    [d('shipment'), current.package_tracking_number ?? '—'],
  ];

  return (
    <section className={styles.officeBox} aria-label={`${d('title')} ${current.reference}`}>
      <p className={styles.officeHead}>
        {current.reference} · {t(prealertStatus(current).key)}
      </p>

      <Banner tone={message.tone}>{message.text}</Banner>

      <dl className={styles.officeGrid}>
        {facts.map(([label, value]) => (
          <div key={label} className={styles.officeField}>
            <dt className={styles.officeLabel}>{label}</dt>
            <dd style={{ margin: 0, whiteSpace: 'pre-line' }}>{value}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.officeHead}>{d('invoice')}</p>
      {current.documents.length === 0 ? (
        <p className={styles.officeNote}>{d('noInvoice')}</p>
      ) : (
        <ul>
          {current.documents.map((document) => (
            <li key={document.id}>
              <a href={prealertDocumentUrl(document.url)} target="_blank" rel="noopener noreferrer">
                {document.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {current.carrier_tracking && <CourierTracking tracking={current.carrier_tracking} />}

      {office && current.status !== 'cancelled' && (
        <div className={styles.officeGrid}>
          <form
            className={styles.officeField}
            onSubmit={(event) => {
              event.preventDefault();
              if (packageNumber.trim()) {
                run(() => addPrealertToShipment(current.id, packageNumber.trim()), d('added'));
              }
            }}
          >
            <label className={styles.officeLabel} htmlFor={`prealert-package-${current.id}`}>
              {d('addToShipment')}
            </label>
            <input
              id={`prealert-package-${current.id}`}
              className={styles.officeInput}
              value={packageNumber}
              onChange={(event) => setPackageNumber(event.target.value)}
              placeholder="PLSM-00042"
            />
            <span className={styles.officeNote}>{d('addHint')}</span>
            <button type="submit" className={styles.rowButton} disabled={busy || !packageNumber.trim()}>
              {d('add')}
            </button>
          </form>
          <div className={styles.officeField}>
            <span className={styles.officeLabel}>{d('cancelTitle')}</span>
            <button
              type="button"
              className={styles.linkButton}
              disabled={busy}
              onClick={() => {
                if (window.confirm(d('cancelConfirm'))) run(() => cancelStaffPrealert(current.id), d('cancelled'));
              }}
            >
              {d('cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
