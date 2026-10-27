// src/pages/Warehouse/PackagePage.jsx
//
// One package, worked through from top to bottom:
//
//   Verify → Measure → Mark Ready → Next Package
//
// (No packaging step: a measured package is marked ready straight away.)
//
// The step shown is worked out from where the package already is, so a box
// scanned halfway through its process picks up where it was left. Every
// completed action says so in a big green line and offers Next Package, which
// goes straight back to the scanner.
//
// Underneath: damage reporting, the rack location, the package's timeline,
// and the full shipment card for corrections.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /warehouse/packages/:id
//   Who can open: warehouse workers and office staff
//   Links to:     /warehouse, /warehouse/scan (Next package), /warehouse/intake,
//                 /warehouse/shipments/:id/label
//   Linked from:  Warehouse home, Scan, the office Packages and Overview pages, Package history,
//                 Label ("Back")
//   Backend:      api/staff.js, api/warehouse.js

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getWarehouseShipment } from '../../api/staff';
import {
  errorMessage,
  getPackageTimeline,
  listPackageDamage,
  moveStage,
} from '../../api/warehouse';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import DamageForm from './DamageForm';
import DamageReport from './DamageReport';
import MeasurementForm from './MeasurementForm';
import { Message, Timeline } from './opsUi';
import PackagePhotos from './PackagePhotos';
import { useWarehouseAccess } from './accessContext';
import ShipmentCard from './ShipmentCard';
import { useLoad } from './useLoad';
import styles from './Ops.module.css';

const LEFT = ['in_transit', 'arrived', 'delivered', 'cancelled'];
// No packaging step: once measured, a package is marked ready for shipping.
const STEP_KEYS = ['verify', 'measure', 'ready'];
const P = 'dashboard.flow.package.';

/** Which step a package in this stage is on. */
function stepFor(stage) {
  if (['awaiting_pickup', 'received', 'awaiting_measurement'].includes(stage)) return 'verify';
  if (['measured', 'awaiting_packaging', 'packed'].includes(stage)) return 'ready';
  return 'done';
}

function Steps({ shipment, step }) {
  const { t } = useLanguage();
  const stage = shipment.warehouse_stage;
  const done = [
    step !== 'verify',
    // Measured here, or on the intake form (which is enough on its own).
    Boolean(shipment.measurement) || Boolean(shipment.intake_measured),
    ['ready', 'shipped'].includes(stage),
  ];
  const current = { verify: 0, measure: 1, ready: 2 }[step] ?? -1;

  return (
    <ol className={styles.steps} aria-label={t(`${P}progress`)}>
      {STEP_KEYS.map((key, index) => {
        const className = [
          styles.step,
          done[index] && index !== current ? styles.stepDone : '',
          index === current ? styles.stepCurrent : '',
        ].join(' ');
        return (
          <li key={key} className={className} aria-current={index === current ? 'step' : undefined}>
            <span className={styles.stepDot}>{done[index] && index !== current ? '✓' : index + 1}</span>
            <span>{t(`${P}steps.${key}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A decimal the way the rest of the back office writes one: "12,5". */
function number(value, digits) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toLocaleString('nl-NL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** "60 × 40 × 40 cm", or '' when the box has not been measured yet. */
function dimensions(measurement) {
  if (!measurement) return '';
  const sides = [measurement.length_cm, measurement.width_cm, measurement.height_cm];
  if (sides.some((side) => side === null || side === undefined || side === '')) return '';
  return `${sides.map((side) => number(side, 0)).join(' × ')} cm`;
}

function Fact({ label, children, big }) {
  return (
    <div className={`${styles.fact} ${big ? styles.factBig : ''}`}>
      <dt>{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

/**
 * The warehouse the package is in. Fixed: every package is in the one
 * warehouse (settings WAREHOUSE_DEFAULT_LOCATION, PAYLESSHOPMORE), so it is
 * shown rather than chosen, and the server refuses any other location.
 */
export function LocationForm({ shipment }) {
  const { t } = useLanguage();
  const warehouse = shipment.location_choices?.default || shipment.warehouse_location || '';
  return (
    <div className={styles.field}>
      <span className={styles.label}>{t(`${P}warehouse`)}</span>
      <strong className={styles.fixedValue}>{warehouse || '—'}</strong>
    </div>
  );
}

export default function PackagePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState({ key: null, status: 'loading' });
  const [shipment, setShipment] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [step, setStep] = useState('verify');
  const [flash, setFlash] = useState({ tone: '', text: '' });
  const [worked, setWorked] = useState(false);
  const [busy, setBusy] = useState('');
  const [reportingDamage, setReportingDamage] = useState(false);
  const topRef = useRef(null);
  // What an admin has left on for this account (Dashboard -> Warehouse
  // access). Switched-off parts are left out of this page.
  const { can } = useWarehouseAccess();
  const showHistory = can('activity');
  const key = `${id}#${attempt}`;

  // This package's damage reports, open and closed - the warehouse page no
  // longer has a Damaged list, so they are reported AND resolved here.
  // `damageKey` changes after a report or a resolve, to fetch them again.
  const [damageKey, setDamageKey] = useState(0);
  const damage = useLoad(
    () => (can('damage') ? listPackageDamage(id) : Promise.resolve([])),
    `damage:${id}#${damageKey}`,
  );
  const reports = damage.state === 'ready' ? damage.data : [];

  useEffect(() => {
    let cancelled = false;
    Promise.all([getWarehouseShipment(id), showHistory ? getPackageTimeline(id) : []])
      .then(([data, entries]) => {
        if (cancelled) return;
        setShipment(data);
        setTimeline(entries);
        setStep(stepFor(data.warehouse_stage));
        setLoad({ key, status: 'ready' });
      })
      .catch((error) => {
        if (!cancelled) setLoad({ key, status: error?.status === 404 ? 'missing' : 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, key, showHistory]);

  const refreshTimeline = useCallback(() => {
    if (!showHistory) return;
    getPackageTimeline(id)
      .then(setTimeline)
      .catch(() => {});
  }, [id, showHistory]);

  /** Every completed action ends here: new data, a green line, Next Package. */
  function completed(data, text, nextStep) {
    setShipment(data);
    setFlash({ tone: 'success', text });
    setWorked(true);
    if (nextStep) setStep(nextStep);
    refreshTimeline();
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function failed(error, fallback) {
    setFlash({ tone: 'error', text: errorMessage(error, fallback, t) });
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function move(stage, text, nextStep) {
    setBusy(stage);
    setFlash({ tone: '', text: '' });
    try {
      const data = await moveStage(shipment.id, stage);
      // The server may have moved the package further by itself (automatic
      // stages, backend warehouse/operations.py): "Packaged" becomes "Ready
      // for shipping" when nothing is open. Then the work is done.
      if (stage === 'packed' && data.warehouse_stage === 'ready') {
        completed(data, t(`${P}readyDone`), 'done');
      } else {
        completed(data, text, nextStep);
      }
    } catch (error) {
      failed(error, t(`${P}moveError`));
    } finally {
      setBusy('');
    }
  }

  async function confirmPackage() {
    // Already measured on the intake form (or here before): no second
    // measuring, straight on to marking it ready.
    const next = shipment.measurement || shipment.intake_measured ? 'ready' : 'measure';
    // An expected package being held is a package received.
    if (shipment.warehouse_stage === 'awaiting_pickup' && shipment.allowed_stages.includes('received')) {
      await move('received', t(`${P}received`), next);
      return;
    }
    setFlash({ tone: '', text: '' });
    setStep(next);
  }

  const nextPackage = () => navigate('/warehouse/scan');
  const state = load.key === key ? load.status : 'loading';
  const saving = t('dashboard.flow.common.saving');

  if (state === 'loading') return <Loading inline />;
  if (state === 'error') return <ConnectionError inline onRetry={() => setAttempt((n) => n + 1)} />;
  if (state === 'missing') {
    return (
      <div className={styles.page}>
        <Message tone="error">{t(`${P}missing`)}</Message>
        <button type="button" className={`${styles.primary} ${styles.wide}`} onClick={nextPackage}>
          {t(`${P}scanAnother`)}
        </button>
      </div>
    );
  }

  const hasLeft = LEFT.includes(shipment.status);
  const canMove = (stage) => shipment.allowed_stages.includes(stage);

  return (
    <div className={styles.page} ref={topRef}>
      <Link to="/warehouse" className={styles.backLink}>
        {t('dashboard.flow.common.backToPackages')}
      </Link>

      <Message tone={flash.tone || 'info'}>{flash.text}</Message>

      {/* Verify: the facts a worker checks against the label in their hand. */}
      <section className={styles.card} aria-labelledby="package-heading">
        <div className={styles.cardHead}>
          <h1 id="package-heading" className={styles.pageTitle}>
            {shipment.package_number}
          </h1>
          <span className={styles.statusPill}>{shipment.workflow_status_display}</span>
        </div>

        <dl className={styles.identity}>
          <Fact label={t(`${P}facts.tracking`)} big>
            {shipment.tracking_number}
          </Fact>
          <Fact label={t(`${P}facts.customer`)}>
            {shipment.customer}
            {shipment.customer_phone && <span className={styles.factSub}>{shipment.customer_phone}</span>}
          </Fact>
          <Fact label={t(`${P}facts.order`)}>{shipment.order_number}</Fact>
          <Fact label={t(`${P}facts.destination`)}>
            {shipment.destination}
            {shipment.delivery_address_text && (
              <span className={styles.factSub}>{shipment.delivery_address_text}</span>
            )}
          </Fact>
          <Fact label={t(`${P}facts.type`)}>
            {[shipment.package_type, shipment.freight_display].filter(Boolean).join(' · ')}
          </Fact>
          <Fact label={t(`${P}facts.status`)}>{t(`dashboard.flow.stages.${shipment.warehouse_stage}`)}</Fact>
          <Fact label={t(`${P}facts.location`)}>{shipment.warehouse_location}</Fact>

          {/* The measurement, from the current record on the shipment. Each
              falls back to the em dash a Fact draws for an empty value, so a
              box that has not reached the measure step yet shows the same
              three rows waiting to be filled rather than a card that changes
              shape once somebody picks up a tape measure. */}
          <Fact label={t(`${P}facts.dimensions`)}>{dimensions(shipment.measurement)}</Fact>
          <Fact label={t(`${P}facts.weight`)}>
            {shipment.measurement && `${number(shipment.measurement.weight_kg, 1)} kg`}
          </Fact>
          <Fact label={t(`${P}facts.chargeable`)}>
            {shipment.measurement &&
              `${number(shipment.measurement.chargeable_weight_kg, 1)} kg`}
          </Fact>
          <Fact label={t(`${P}facts.quantity`)}>
            {shipment.intake?.colli ? `${shipment.intake.colli} colli` : ''}
          </Fact>
          <Fact label={t(`${P}facts.invoice`)}>
            {shipment.invoice ? (
              <>
                {shipment.invoice.number}
                <span className={styles.factSub}>{shipment.invoice.status_display}</span>
              </>
            ) : (
              t(`${P}facts.noInvoice`)
            )}
          </Fact>
        </dl>

        {/* A problem is not a flag here: ShipmentCard below shows it with its
            "Problem solved" button. */}
        {(shipment.has_open_damage || shipment.overdue) && (
          <div className={styles.flagRow}>
            {shipment.has_open_damage && <span className={styles.flag}>{t(`${P}flagDamage`)}</span>}
            {shipment.overdue && <span className={`${styles.flag} ${styles.flagWarn}`}>{t(`${P}flagOverdue`)}</span>}
          </div>
        )}

        {/* The rest of the shipment in the same card: the intake sheet, the
            products, a problem, the stage corrections and the label. */}
        <ShipmentCard
          shipment={shipment}
          onChange={(data) => {
            setShipment(data);
            setStep(stepFor(data.warehouse_stage));
            refreshTimeline();
          }}
        />
      </section>

      {hasLeft ? (
        <Message tone="info">{fill(t(`${P}left`), { status: shipment.status_display.toLowerCase() })}</Message>
      ) : (
        <>
          <Steps shipment={shipment} step={step} />

          {step === 'verify' && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>{t(`${P}verifyTitle`)}</h2>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.success}
                  disabled={Boolean(busy)}
                  onClick={confirmPackage}
                  autoFocus
                >
                  {busy ? saving : t(`${P}verifyYes`)}
                </button>
                <button type="button" className={styles.secondary} onClick={nextPackage}>
                  {t(`${P}verifyNo`)}
                </button>
              </div>
            </section>
          )}

          {step === 'measure' && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>{t(`${P}measureTitle`)}</h2>
              {shipment.intake_measured && (
                <Message tone="info">{t(`${P}measuredOnIntake`)}</Message>
              )}
              {!can('measurements') ? (
                <>
                  <Message tone="info">{t(`${P}switchedOff`)}</Message>
                  <button
                    type="button"
                    className={`${styles.secondary} ${styles.wide}`}
                    onClick={() => setStep('ready')}
                  >
                    {t(`${P}keepMeasurements`)}
                  </button>
                </>
              ) : (
              <MeasurementForm
                shipment={shipment}
                onSaved={({ measurement, shipment: data }) =>
                  completed(
                    data,
                    fill(t(`${P}measured`), {
                      weight: Number(measurement.weight_kg),
                      volume: Number(measurement.volume_m3),
                      dim: Number(measurement.dimensional_weight_kg),
                    }),
                    'ready',
                  )
                }
              />
              )}
              {can('measurements') && (shipment.measurement || shipment.intake_measured) && (
                <button
                  type="button"
                  className={`${styles.secondary} ${styles.wide} ${styles.gapTop}`}
                  onClick={() => setStep('ready')}
                >
                  {t(`${P}keepMeasurements`)}
                </button>
              )}
            </section>
          )}

          {step === 'ready' && (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>{t(`${P}readyTitle`)}</h2>
              <p className={`${styles.pageLead} ${styles.gapBottom}`}>{t(`${P}readyLead`)}</p>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.success}
                  disabled={Boolean(busy) || !canMove('ready')}
                  onClick={() => move('ready', t(`${P}readyDone`), 'done')}
                >
                  {busy === 'ready' ? saving : t(`${P}markReady`)}
                </button>
                <button type="button" className={styles.secondary} onClick={() => setStep('measure')}>
                  {t(`${P}remeasure`)}
                </button>
              </div>
            </section>
          )}

          {step === 'done' && (
            <section className={styles.done}>
              <p className={styles.doneTitle}>
                {shipment.warehouse_stage === 'shipped' ? t(`${P}doneShipped`) : t(`${P}doneReady`)}
              </p>
              <p className={styles.doneText}>{t(`${P}doneText`)}</p>
              <div className={styles.buttonRow}>
                {/* The label goes on the box before it leaves the floor. */}
                <Link to={`/warehouse/shipments/${shipment.id}/label`} className={styles.secondary}>
                  {t(`${P}printLabel`)}
                </Link>
                <button type="button" className={styles.primary} onClick={nextPackage} autoFocus>
                  {t('dashboard.flow.common.nextPackage')}
                </button>
              </div>
            </section>
          )}

          {worked && step !== 'done' && (
            <button
              type="button"
              className={`${styles.secondary} ${styles.wide} ${styles.gapBottom}`}
              onClick={nextPackage}
            >
              {t('dashboard.flow.common.nextPackage')}
            </button>
          )}
        </>
      )}

      {/* Photos for the customer: they appear in the shipment's pop-up on
          the customer's profile page. */}
      {can('photos') && <PackagePhotos shipmentId={shipment.id} onChanged={refreshTimeline} />}

      <section className={styles.card}>
        {reportingDamage ? (
          <>
            <h2 className={styles.cardTitle}>{t(`${P}damageTitle`)}</h2>
            <DamageForm
              shipment={shipment}
              onCancel={() => setReportingDamage(false)}
              onSaved={({ damage_report: report, shipment: data }) => {
                setReportingDamage(false);
                setDamageKey((n) => n + 1);
                completed(
                  data,
                  fill(t(`${P}damageReported`), { type: t(`dashboard.flow.damage.types.${report.damage_type}`) }),
                );
              }}
            />
          </>
        ) : (
          can('damage') && (
            <div className={styles.buttonRow}>
              <button type="button" className={styles.danger} onClick={() => setReportingDamage(true)}>
                {t(`${P}reportDamage`)}
              </button>
            </div>
          )
        )}
        {/* Every report on this package, each closed with Resolve once it
            has been dealt with. */}
        {reports.length > 0 && (
          <div className={styles.gapTop}>
            {reports.map((report) => (
              <DamageReport
                key={report.id}
                report={report}
                showPackage={false}
                onResolved={() => {
                  setDamageKey((n) => n + 1);
                  refreshTimeline();
                }}
              />
            ))}
          </div>
        )}
        {!hasLeft && (
          <div className={styles.gapTop}>
            <LocationForm shipment={shipment} />
          </div>
        )}
      </section>

      {showHistory && (
        <details className={styles.disclosure} open>
          <summary>
            <span className={styles.disclosureText}>
              <span className={styles.disclosureTitle}>{fill(t(`${P}history`), { count: timeline.length })}</span>
              <span className={styles.disclosureLead}>{t(`${P}historyLead`)}</span>
            </span>
            <span className={styles.disclosureToggle} aria-hidden="true" />
          </summary>
          <section className={styles.card}>
            <Timeline entries={timeline} />
          </section>
        </details>
      )}
    </div>
  );
}
