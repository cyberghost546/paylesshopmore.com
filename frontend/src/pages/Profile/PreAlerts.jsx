// src/pages/Profile/PreAlerts.jsx
//
// "On the way to our warehouse": the customer's pre-alerts, at the top of My
// shipments. A pre-alert is a parcel the customer told us about; it becomes
// part of one of our shipments (the list below it) once the office adds it.
//
// Each row: our reference (PA-...), the courier and its number, the shop and
// what was bought, where it is now, and the date it was sent. Clicking a row
// opens everything: the courier's updates, the receiver, the value, the
// invoice files, and "Cancel" while the parcel is not with us yet.
//
// The status shown is only ever what has been recorded: the courier's own
// updates (or our team's), the warehouse scan, or the office adding it to a
// shipment. Nothing moves on its own.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { cancelPrealert, listPrealerts, prealertDocumentUrl } from '../../api/prealerts';
import CourierTracking from '../../components/CourierTracking/CourierTracking';
import HelpDialog from '../../components/HelpDialog/HelpDialog';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { prealertStatus } from './prealertStatus';
import styles from './Profile.module.css';

export default function PreAlerts() {
  const { t, language } = useLanguage();
  const p = (key, values) => fill(t(`prealert.${key}`), values);
  const [prealerts, setPrealerts] = useState(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    listPrealerts().then(
      (rows) => {
        setPrealerts(rows);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);

  const day = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' });
  const selected = prealerts?.find((row) => row.id === openId);

  return (
    <div className={styles.prealerts} data-tour="profile-prealerts">
      <div className={styles.prealertsHead}>
        <h3 className={styles.prealertsTitle}>{p('listTitle')}</h3>
        <Link to="/prealert" className={styles.submit}>
          {p('newButton')}
        </Link>
      </div>

      {failed && <p className={styles.invoiceMessage}>{p('loadFailed')}</p>}
      {prealerts && prealerts.length === 0 && <p className={styles.invoiceMessage}>{p('empty')}</p>}

      {prealerts && prealerts.length > 0 && (
        <ul className={styles.prealertList}>
          {prealerts.map((row) => {
            const status = prealertStatus(row);
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.prealertRow}
                  onClick={() => setOpenId(row.id)}
                  aria-haspopup="dialog"
                >
                  <span className={styles.prealertMain}>
                    <strong>{row.reference}</strong>
                    <span>
                      {row.carrier.name} {row.tracking_number}
                    </span>
                    <span className={styles.prealertMuted}>
                      {row.shop_name}: {row.description}
                    </span>
                  </span>
                  <span className={styles.prealertSide}>
                    <span className={styles.prealertBadge} data-tone={status.tone}>
                      {t(status.key)}
                    </span>
                    <span className={styles.prealertMuted}>{day.format(new Date(row.created_at))}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <HelpDialog
          open
          wide
          onClose={() => setOpenId(null)}
          title={`${p('dialogTitle')} ${selected.reference}`}
          closeLabel={p('close')}
          doneLabel={p('close')}
        >
          <PreAlertDetails
            prealert={selected}
            onChanged={(updated) =>
              setPrealerts((rows) => rows.map((row) => (row.id === updated.id ? updated : row)))
            }
          />
        </HelpDialog>
      )}
    </div>
  );
}

/** Everything about one pre-alert, inside the pop-up. */
function PreAlertDetails({ prealert, onChanged }) {
  const { t, language } = useLanguage();
  const p = (key, values) => fill(t(`prealert.${key}`), values);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const money = new Intl.NumberFormat(language, { style: 'currency', currency: prealert.currency });
  const status = prealertStatus(prealert);

  async function cancel() {
    if (!window.confirm(p('cancelConfirm'))) return;
    setBusy(true);
    try {
      onChanged(await cancelPrealert(prealert.id));
      setMessage({ ok: true, text: p('cancelled') });
    } catch (error) {
      const detail = error?.fields?.detail;
      setMessage({ ok: false, text: detail ? String(detail) : p('errors.failed') });
    } finally {
      setBusy(false);
    }
  }

  const facts = [
    [p('statusLabel'), t(status.key)],
    [p('shop'), prealert.shop_name],
    [p('description'), prealert.description],
    [p('consignee'), [prealert.consignee_name, prealert.consignee_address_text].filter(Boolean).join('\n')],
    // Older pre-alerts have a value; new ones usually do not.
    prealert.declared_value != null ? [p('value'), money.format(Number(prealert.declared_value))] : null,
    prealert.package_tracking_number ? [p('inShipment'), prealert.package_tracking_number] : null,
  ].filter(Boolean);

  return (
    <div className={styles.prealertDetails}>
      <dl className={styles.prealertFacts}>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {prealert.carrier_tracking && <CourierTracking tracking={prealert.carrier_tracking} />}

      <h3 className={styles.prealertsTitle}>{p('invoice')}</h3>
      {prealert.documents.length === 0 ? (
        <p className={styles.invoiceMessage}>{p('noInvoice')}</p>
      ) : (
        <ul className={styles.prealertFiles}>
          {prealert.documents.map((document) => (
            <li key={document.id}>
              <a href={prealertDocumentUrl(document.url)} target="_blank" rel="noopener noreferrer">
                {document.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className={message.ok ? styles.ok : styles.failure} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}

      {prealert.can_cancel && (
        <button type="button" className={styles.linkButton} onClick={cancel} disabled={busy}>
          {p('cancel')}
        </button>
      )}
    </div>
  );
}
