// src/pages/Dashboard/MeasurementsList.jsx
//
// What the warehouse measured, for the office: every intake sheet with lines
// on it, its lines, and what they add up to. Read-only - the lines are edited
// on the sheet itself, and each row links there.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/measurements
//   Who can open: office staff
//   Links to:     /warehouse/intake?sheet=... (the sheet)
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js

import { Link, useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import {
  INTAKE_FREIGHT,
  INTAKE_PACKAGING,
  INTAKE_STATUSES,
  listIntakeSheets,
} from '../../api/staff';
import { labelFor as optionLabel } from './statuses';
import { useCollection } from './useCollection';
import { formatDate } from './format';
import {
  Empty,
  FilterSelect,
  Pagination,
  SearchInput,
  StatusBadge,
  Toolbar,
} from './ui';
import styles from './Dashboard.module.css';
import { labelFor, translatedOptions, usePageText } from './usePageText';

// Module scope, so useCollection sees the same function on every render.
const listMeasuredSheets = (filters) =>
  listIntakeSheets({ ...filters, measured: 'true' });

function number(value, digits) {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString('nl-NL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** "10 × Doos · 60 × 40 × 40 cm · 12 kg each" */
function describeLine(line, d, intake) {
  const size = [line.length_cm, line.width_cm, line.height_cm]
    .map((value) => number(value, 1))
    .join(' × ');
  const kind = line.packaging
    ? ` ${labelFor(intake, 'packaging', line.packaging, optionLabel(INTAKE_PACKAGING, line.packaging))}`
    : '';
  const weight = line.weight_kg === null ? '— kg' : d('each', { weight: number(line.weight_kg, 2) });

  return `${line.quantity} ×${kind} · ${size} cm · ${weight}`;
}

export default function MeasurementsList() {
  const [params] = useSearchParams();
  const d = usePageText('measurementsList');
  const c = usePageText('common');
  const intake = usePageText('intake');

  const list = useCollection(
    listMeasuredSheets,
    {
      status: params.get('status') ?? '',
      freight: params.get('freight') ?? '',
    },
    params.get('search') ?? '',
  );

  return (
    <>
      {/* data-tour hooks: this page's tour ("dashboardMeasurements" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-measurements-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Toolbar tour="db-measurements-filters">
        <SearchInput
          value={list.searchInput}
          onChange={list.setSearchInput}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          label={c('status')}
          value={list.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={translatedOptions(INTAKE_STATUSES, c, 'intakeStatus')}
          allLabel={c('anyStatus')}
        />
        <FilterSelect
          label={d('freight')}
          value={list.filters.freight}
          onChange={(value) => list.setFilter('freight', value)}
          options={translatedOptions(INTAKE_FREIGHT, c, 'freight')}
          allLabel={d('seaAndAir')}
        />
      </Toolbar>

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>{d('noMatch')}</Empty>
        ) : (
          <div className={styles.tableWrap} data-tour="db-measurements-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colSheet')}</th>
                  <th scope="col">{d('colLines')}</th>
                  <th scope="col">{d('colColli')}</th>
                  <th scope="col">m³</th>
                  <th scope="col">{d('colWeight')}</th>
                  <th scope="col">{d('colChargeable')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((sheet) => {
                  const { totals } = sheet;

                  return (
                    <tr key={sheet.id}>
                      <td>
                        <Link
                          className={styles.link}
                          to={`/warehouse/intake?sheet=${sheet.id}`}
                        >
                          {sheet.label}
                        </Link>
                        <div>
                          <StatusBadge tone={sheet.released ? 'done' : 'attention'}>
                            {labelFor(c, 'intakeStatus', sheet.status, sheet.status_display)}
                          </StatusBadge>
                        </div>
                        <div className={styles.mutedCell}>
                          {[sheet.supplier || sheet.sender, sheet.destination]
                            .filter(Boolean)
                            .join(' → ') || d('noDetails')}
                        </div>
                        <div className={styles.mutedCell}>
                          {sheet.freight ? labelFor(c, 'freight', sheet.freight, sheet.freight_display) : d('freightNotSet')} ·{' '}
                          {formatDate(sheet.received_on)}
                        </div>
                      </td>

                      <td>
                        {sheet.measurements.map((line) => (
                          <div
                            key={line.id}
                            className={line.complete ? undefined : styles.mutedCell}
                          >
                            {describeLine(line, d, intake)}
                            {!line.complete && d('incomplete')}
                            {line.note && (
                              <div className={styles.mutedCell}>{line.note}</div>
                            )}
                          </div>
                        ))}
                      </td>

                      <td className={styles.numberCell}>{totals.colli ?? '—'}</td>
                      <td className={styles.numberCell}>{number(totals.volume_m3, 3)}</td>
                      <td className={styles.numberCell}>
                        {number(totals.weight_kg, 1)} kg
                        {sheet.declared_weight_kg !== null && (
                          <div className={styles.mutedCell}>
                            {d('declared', { weight: number(sheet.declared_weight_kg, 1) })}
                          </div>
                        )}
                      </td>
                      <td className={styles.numberCell}>
                        {/* The server works the chargeable weight out by the
                            sheet's own transport (sea 1 m³ = 1000 kg, air
                            1 m³ = 167 kg). No transport chosen: nothing to show. */}
                        {sheet.freight
                          ? `${number(totals.chargeable_weight_kg, 1)} kg`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      <Pagination
        page={list.page}
        count={list.count}
        hasNext={list.hasNext}
        hasPrevious={list.hasPrevious}
        onChange={list.setPage}
      />
    </>
  );
}
