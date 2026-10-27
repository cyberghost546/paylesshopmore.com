// src/pages/Dashboard/Reports.jsx
//
// READ THIS FIRST
// ---------------
// "Monthly report": how did one month go? Top to bottom:
//
//   1. A month picker (with ‹ and › for the month before / after), and
//      buttons to print the page or download it as a CSV for Excel.
//   2. Headline numbers for the month, each with the change compared with
//      the month before ("▲ +12% vs. September").
//   3. A bar chart of the last 12 months - bookings, shipped packages or
//      invoiced amount, picked with the tabs above it.
//   4. Bookings per destination and per kind of freight.
//
// All numbers come from ONE request: GET /api/staff/reports/monthly/?month=
// (backend staff/reports.py, which also explains where each number comes from).
// The chosen month is kept in the address (?month=2026-10), so a report can
// be bookmarked or sent to a colleague.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/reports
//   Who can open: office staff
//   Links to:     nothing
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js (getMonthlyReport)

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import { getMonthlyReport } from '../../api/staff';
import { useLanguage } from '../../i18n/useLanguage';
import { formatMoney } from './format';
import { change, shiftMonth } from './reportMath';
import { Banner, Empty } from './ui';
import { usePageText } from './usePageText';
import styles from './Dashboard.module.css';

// Month names follow the dashboard language.
const DATE_LOCALES = { nl: 'nl-NL', en: 'en-GB', pap: 'nl-CW' };

// The headline numbers, in the order they are shown. `money` and `weight`
// say how to write the value; everything else is a plain count.
const STATS = [
  { key: 'bookings' },
  { key: 'packages_shipped' },
  { key: 'packages_delivered' },
  { key: 'invoiced', money: true },
  { key: 'invoices_sent' },
  { key: 'weight_shipped_kg', weight: true },
  { key: 'average_weight_kg', weight: true },
  { key: 'new_customers' },
  { key: 'quotes' },
  { key: 'messages' },
];

// What the chart can show: a field of each row in `months`.
const CHART_METRICS = [
  { key: 'bookings' },
  { key: 'packages_shipped' },
  { key: 'invoiced', money: true },
];

const ARROWS = { up: '▲', down: '▼', flat: '–' };

/** '2026-10' for the month we are in now. */
function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** A number in the way this stat is written: '€ 1.234,50', '12,5 kg' or '7'. */
function formatStat(stat, value) {
  if (value === null || value === undefined) return '—';
  if (stat.money) return formatMoney(value);
  if (stat.weight) return `${Number(value).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} kg`;
  return Number(value).toLocaleString('nl-NL');
}

/** Opens the browser's "save file" for a CSV made of `rows` (arrays of cells). */
function downloadCsv(filename, rows) {
  // Each cell in quotes, with any quote inside doubled - the CSV rule - so a
  // destination like 'Overig, "Saba"' cannot break the columns.
  const text = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  // The \uFEFF at the start tells Excel the file is UTF-8, so "Curaçao" is
  // not shown as "CuraÃ§ao". Semicolons, because Dutch Excel expects them.
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** One headline number with its change from the month before. */
function ReportStat({ label, value, moved, previousLabel, d }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {moved && (
        <span className={`${styles.statDelta} ${styles[`kpiDelta_${moved.direction}`]}`}>
          <span aria-hidden="true">{ARROWS[moved.direction]}</span>{' '}
          {moved.direction === 'flat'
            ? d('noChange')
            : moved.percent === null
              ? d('fromNone')
              : `${moved.percent > 0 ? '+' : ''}${moved.percent}%`}
          <span className={styles.statDeltaNote}> {d('vsMonth', { month: previousLabel })}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Twelve bars, one per month; the chosen month is highlighted. Plain HTML
 * bars (no chart library): each bar's height is its value as a share of the
 * highest month.
 */
function MonthChart({ months, metric, selected, monthLabel, d }) {
  const values = months.map((row) => Number(row[metric.key] ?? 0));
  const highest = Math.max(...values, 0);

  return (
    <ol className={styles.reportChart} aria-label={d(`metric.${metric.key}`)}>
      {months.map((row, index) => {
        const value = values[index];
        // At least a sliver for a month with something in it, so it does not
        // look the same as an empty month.
        const height = highest === 0 ? 0 : Math.max((value / highest) * 100, value > 0 ? 3 : 0);
        const shown = metric.money ? formatMoney(value) : value.toLocaleString('nl-NL');
        return (
          <li
            key={row.month}
            className={row.month === selected ? `${styles.reportBar} ${styles.reportBarSelected}` : styles.reportBar}
            title={`${monthLabel(row.month, 'long')}: ${shown}`}
          >
            <span className={styles.reportBarValue}>{shown}</span>
            <span className={styles.reportBarTrack}>
              <span className={styles.reportBarFill} style={{ height: `${height}%` }} />
            </span>
            <span className={styles.reportBarLabel}>{monthLabel(row.month, 'short')}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function Reports() {
  const d = usePageText('reports');
  const { language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month') : thisMonth();

  const [attempt, setAttempt] = useState(0);
  // `key` says which answer belongs to which month, so an old answer that
  // arrives late is never shown under a newer month.
  const key = `${month}#${attempt}`;
  const [answer, setAnswer] = useState({ key: null, status: 'loading', data: null });
  const [metricKey, setMetricKey] = useState('bookings');
  const metric = CHART_METRICS.find((item) => item.key === metricKey) ?? CHART_METRICS[0];

  useEffect(() => {
    let cancelled = false;
    getMonthlyReport(month)
      .then((data) => {
        if (!cancelled) setAnswer({ key, status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ key, status: 'error', data: null });
      });
    return () => {
      cancelled = true;
    };
    // `key` already holds the month and the retry counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const state = answer.key === key ? answer.status : 'loading';
  const report = state === 'ready' ? answer.data : null;

  /** '2026-10' -> 'oktober 2026' (long) or 'okt' (short), in the dashboard language. */
  function monthLabel(value, style = 'long') {
    const [year, monthNumber] = value.split('-').map(Number);
    const date = new Date(year, monthNumber - 1, 1);
    const options = style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' };
    return new Intl.DateTimeFormat(DATE_LOCALES[language] ?? 'nl-NL', options).format(date);
  }

  function goTo(next) {
    if (!/^\d{4}-\d{2}$/.test(next)) return;
    setParams({ month: next });
  }

  function exportCsv() {
    if (!report) return;
    const rows = [
      [d('csvFigure'), monthLabel(report.month), monthLabel(report.previous_month)],
      ...STATS.map((stat) => [d(`stat.${stat.key}`), report.current[stat.key], report.previous[stat.key]]),
      [],
      [d('destination'), d('colBookings'), d('colWeight')],
      ...report.by_destination.map((row) => [row.label, row.bookings, row.weight_kg]),
      [],
      [d('colMonth'), d('metric.bookings'), d('metric.packages_shipped'), d('metric.invoiced')],
      ...report.months.map((row) => [row.month, row.bookings, row.packages_shipped, row.invoiced]),
    ];
    downloadCsv(`report-${report.month}.csv`, rows);
  }

  const previousLabel = report ? monthLabel(report.previous_month) : '';

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>
          {d('title')}: {monthLabel(month)}
        </h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      {/* Hidden when printing (see .reportToolbar in Dashboard.module.css). */}
      <div className={styles.reportToolbar}>
        <button type="button" className={styles.rowButton} onClick={() => goTo(shiftMonth(month, -1))}>
          ‹ {d('previous')}
        </button>
        <label className={styles.reportMonth}>
          <span className={styles.srOnly}>{d('pickMonth')}</span>
          <input
            type="month"
            value={month}
            max={thisMonth()}
            onChange={(event) => goTo(event.target.value)}
            aria-label={d('pickMonth')}
          />
        </label>
        <button
          type="button"
          className={styles.rowButton}
          onClick={() => goTo(shiftMonth(month, 1))}
          disabled={month >= thisMonth()}
        >
          {d('next')} ›
        </button>
        <span className={styles.reportToolbarGap} />
        <button type="button" className={styles.rowButton} onClick={() => window.print()} disabled={!report}>
          {d('print')}
        </button>
        <button type="button" className={styles.rowButton} onClick={exportCsv} disabled={!report}>
          {d('downloadCsv')}
        </button>
      </div>

      {state === 'loading' && <Loading inline />}
      {state === 'error' && <ConnectionError inline onRetry={() => setAttempt((n) => n + 1)} />}

      {report && (
        <>
          {report.is_current && <Banner tone="info">{d('stillRunning')}</Banner>}

          <section className={styles.section}>
            <div className={styles.stats}>
              {STATS.map((stat) => (
                <ReportStat
                  key={stat.key}
                  label={d(`stat.${stat.key}`)}
                  value={formatStat(stat, report.current[stat.key])}
                  moved={change(report.current[stat.key], report.previous[stat.key])}
                  previousLabel={previousLabel}
                  d={d}
                />
              ))}
            </div>
            {report.current.bookings_cancelled > 0 && (
              <p className={styles.panelLead}>{d('cancelledNote', { count: report.current.bookings_cancelled })}</p>
            )}
          </section>

          <section className={`${styles.panel} ${styles.section}`}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{d('lastTwelve')}</h2>
              <div className={styles.reportTabs} role="group" aria-label={d('chartShows')}>
                {CHART_METRICS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={item.key === metric.key ? `${styles.reportTab} ${styles.reportTabActive}` : styles.reportTab}
                    aria-pressed={item.key === metric.key}
                    onClick={() => setMetricKey(item.key)}
                  >
                    {d(`metric.${item.key}`)}
                  </button>
                ))}
              </div>
            </div>
            <MonthChart months={report.months} metric={metric} selected={report.month} monthLabel={monthLabel} d={d} />
          </section>

          <div className={styles.reportColumns}>
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>{d('byDestination')}</h2>
              {report.by_destination.length === 0 ? (
                <Empty>{d('noBookings')}</Empty>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{d('destination')}</th>
                      <th scope="col">{d('colBookings')}</th>
                      <th scope="col">{d('colWeight')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_destination.map((row) => (
                      <tr key={row.destination}>
                        <td>{row.label}</td>
                        <td>{row.bookings}</td>
                        <td>{formatStat({ weight: true }, row.weight_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>{d('byFreight')}</h2>
              {report.by_freight.length === 0 ? (
                <Empty>{d('noBookings')}</Empty>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{d('freight')}</th>
                      <th scope="col">{d('colBookings')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_freight.map((row) => (
                      <tr key={row.freight}>
                        {/* The server's label is Dutch; translated when we know the value. */}
                        <td>{['sea', 'air'].includes(row.freight) ? d(`freightKind.${row.freight}`) : row.label}</td>
                        <td>{row.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
