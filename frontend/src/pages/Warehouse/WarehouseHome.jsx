// src/pages/Warehouse/WarehouseHome.jsx
//
// The warehouse, kept simple: two big buttons and one list.
//
//   Scan Package        -> the scanner; a scanned box opens its own page,
//                          where it is measured, packed, photographed, its
//                          damage reported and resolved, and its history read.
//   New intake sheet    -> a blank intake form (Intake.jsx), for goods that
//                          arrive without a code to scan.
//   Packages in the warehouse
//                       -> every package physically here (received up to
//                          ready), oldest first. "Only problems" narrows it
//                          to damage, a problem note or waiting too long. A
//                          search finds ANY package, also one already shipped.
//
// Refreshes itself every minute so a wall-mounted tablet keeps up. Those
// refreshes go as background requests, which do not keep a shared floor
// device signed in as the last worker (see WarehouseHome.test.jsx).
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /warehouse (the old /warehouse/packages, /measurements, /packaging, /damage and
//                 /activity redirect here)
//   Who can open: warehouse workers and office staff
//   Links to:     /warehouse/scan, /warehouse/intake (New intake sheet), /warehouse/packages/:id
//                 (each package)
//   Linked from:  the warehouse menu "Home", Package page ("Back"), Set PIN, Log in, the office
//                 Overview
//   Backend:      api/staff.js

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createIntakeSheet, listWarehouseShipments } from '../../api/staff';
import { useAuth } from '../../auth/useAuth';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import Loading from '../../components/Loading/Loading';
import { fill } from '../../i18n/fill';
import { useLanguage } from '../../i18n/useLanguage';
import { useWarehouseAccess } from './accessContext';
import { ScanIcon, SheetIcon } from './icons';
import { Message } from './opsUi';
import StagePill from './StagePill';
import { waitedFor } from './waited';
import styles from './Ops.module.css';

const REFRESH_MS = 60_000;
const PAGE_SIZE = 50;
// Physically in the warehouse: arrived, not yet gone. (Not "expected" - it
// is not here yet - and not "shipped".)
const IN_WAREHOUSE = 'received,awaiting_measurement,measured,awaiting_packaging,packed,ready';
// On its way in: a new order the office has given a shipping number (or one
// that has been paid), not here yet. Its own list above the one above, so the
// floor knows what to expect - and opens it to mark it received when it comes.
const EXPECTED = 'awaiting_pickup';

/** Why a package is flagged, in words, or '' when it is not. */
function reasonFor(row, t) {
  if (row.has_open_damage) return t('dashboard.warehouse.home.reasons.damage');
  if (row.has_problem) return fill(t('dashboard.warehouse.home.reasons.problem'), { note: row.problem_note });
  if (row.overdue) return t('dashboard.warehouse.home.reasons.overdue');
  return '';
}

/** One package as a row: number, customer, how long it has waited, stage. */
function PackageRow({ row, t }) {
  const reason = reasonFor(row, t);
  return (
    <li>
      <Link to={`/warehouse/packages/${row.id}`} className={styles.row}>
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{row.tracking_number}</span>
          <span className={styles.rowDetail}>
            {row.customer}
            {row.warehouse_location && ` · ${row.warehouse_location}`}
            {row.warehouse_stage_at &&
              ` · ${fill(t('dashboard.flow.queue.waiting'), { time: waitedFor(row.warehouse_stage_at) })}`}
          </span>
          {reason && <span className={styles.fieldError}>{reason}</span>}
        </span>
        <span className={styles.rowSide}>
          <StagePill stage={row.warehouse_stage} label={t(`dashboard.flow.stages.${row.warehouse_stage}`)} />
        </span>
      </Link>
    </li>
  );
}

/**
 * New orders on their way in: the packages the office has sent to the
 * warehouse by giving the booking its shipping number (bookings/shipments.py
 * send_to_warehouse), and paid ones, while still "Package expected". Shown
 * only while there are some; refreshed with the list below.
 */
function ExpectedPackages({ attempt, t }) {
  const [page, setPage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listWarehouseShipments({ page_size: PAGE_SIZE, stage: EXPECTED }, { background: attempt.timed })
      .then((answer) => {
        if (!cancelled) setPage(answer);
      })
      // Not fatal: the list below has its own error; this one just stays as it was.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (!page || page.results.length === 0) return null;

  return (
    <section className={styles.card} data-tour="wh-expected">
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          {t('dashboard.warehouse.home.expected')} ({page.count})
        </h2>
      </div>
      <p className={styles.empty}>{t('dashboard.warehouse.home.expectedHint')}</p>
      <ul className={styles.rows}>
        {page.results.map((row) => (
          <PackageRow key={row.id} row={row} t={t} />
        ))}
      </ul>
    </section>
  );
}

export default function WarehouseHome() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { can } = useWarehouseAccess();

  // The list's filters. `search` is what is typed; `query` the same after a
  // short pause, so the server is not asked once per key.
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);

  // `timed`: this fetch is the minute's refresh, not somebody doing something.
  const [attempt, setAttempt] = useState({ n: 0, timed: false });
  const [answer, setAnswer] = useState({ status: 'loading', data: null });

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const filters = {
      page_size: PAGE_SIZE,
      // Searching looks through every package; the plain list only at what
      // is in the warehouse now.
      ...(query ? { search: query } : { stage: IN_WAREHOUSE }),
      ...(onlyProblems ? { attention: 'true' } : {}),
    };

    listWarehouseShipments(filters, { background: attempt.timed })
      .then((page) => {
        if (!cancelled) setAnswer({ status: 'ready', data: page });
      })
      .catch(() => {
        // Keep the last good list on a failed refresh.
        if (!cancelled) setAnswer((previous) => ({ status: 'error', data: previous.data }));
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, query, onlyProblems]);

  useEffect(() => {
    const timer = setInterval(() => setAttempt(({ n }) => ({ n: n + 1, timed: true })), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const reload = () => setAttempt(({ n }) => ({ n: n + 1, timed: false }));

  // "New intake sheet": a blank sheet, opened straight away.
  async function startSheet() {
    setStarting(true);
    setStartError('');
    try {
      const sheet = await createIntakeSheet();
      navigate(`/warehouse/intake?sheet=${sheet.id}`);
    } catch {
      setStartError(t('dashboard.warehouse.home.startError'));
      setStarting(false);
    }
  }

  const firstName = user?.firstName || user?.name?.trim().split(' ')[0];
  const page = answer.data;

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>
          {firstName
            ? fill(t('dashboard.warehouse.home.hello'), { name: firstName })
            : t('dashboard.warehouse.home.fallbackTitle')}
        </h1>
      </div>

      {/* The two things a worker comes here to do. */}
      <div className={styles.homeActions}>
        {/* data-tour: the warehouse tour points at these (tutorialSteps.js). */}
        <Link to="/warehouse/scan" className={styles.scanHero} data-tour="wh-scan">
          <ScanIcon />
          {t('dashboard.warehouse.home.scanPackage')}
        </Link>
        {can('intake') && (
          <button
            type="button"
            className={`${styles.scanHero} ${styles.sheetHero}`}
            data-tour="wh-new-sheet"
            disabled={starting}
            onClick={startSheet}
          >
            <SheetIcon />
            {starting ? t('dashboard.warehouse.home.starting') : t('dashboard.warehouse.home.newSheet')}
          </button>
        )}
      </div>
      <Message tone="error">{startError}</Message>

      {!query && <ExpectedPackages attempt={attempt} t={t} />}

      <section className={styles.card} data-tour="wh-list">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            {t('dashboard.warehouse.home.inWarehouse')}
            {page ? ` (${page.count})` : ''}
          </h2>
        </div>

        <div className={styles.homeFilters} data-tour="wh-filters">
          <label className={styles.homeSearch}>
            <span className={styles.srOnly}>{t('dashboard.flow.list.search')}</span>
            <input
              type="search"
              className={styles.input}
              value={search}
              autoComplete="off"
              placeholder={t('dashboard.flow.list.searchPlaceholder')}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className={styles.homeChips} role="group" aria-label={t('dashboard.flow.list.show')}>
            {[
              [false, t('dashboard.flow.list.everything')],
              [true, t('dashboard.flow.list.attention')],
            ].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={onlyProblems === value}
                className={`${styles.homeChip} ${onlyProblems === value ? styles.homeChipOn : ''}`}
                onClick={() => setOnlyProblems(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!page && answer.status === 'loading' && <Loading inline />}
        {!page && answer.status === 'error' && <ConnectionError inline onRetry={reload} />}
        {page && answer.status === 'error' && (
          <Message tone="error">{t('dashboard.warehouse.home.refreshError')}</Message>
        )}

        {page &&
          (page.results.length === 0 ? (
            <p className={styles.empty}>
              {query
                ? t('dashboard.flow.picker.noMatches')
                : onlyProblems
                  ? t('dashboard.warehouse.home.nothingAttention')
                  : t('dashboard.flow.list.empty')}
            </p>
          ) : (
            <ul className={styles.rows}>
              {page.results.map((row) => (
                <PackageRow key={row.id} row={row} t={t} />
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
