// src/pages/Dashboard/Documents.jsx
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/documents
//   Who can open: office staff
//   Links to:     nothing
//   Linked from:  the dashboard sidebar, Overview
//   Backend:      api/staff.js

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import {
  DOCUMENT_KINDS,
  attachDocument,
  listDocuments,
  listPackages,
} from '../../api/staff';
import { formatBytes } from '../../components/FileDrop/formatBytes';
import { useCollection } from './useCollection';
import { formatDateTime } from './format';
import {
  Banner,
  Empty,
  FilterSelect,
  Pagination,
  SearchInput,
  StatusBadge,
  Toolbar,
} from './ui';
import styles from './Dashboard.module.css';
import { labelFor, translatedOptions, usePageText } from './usePageText';

const KIND_TONES = {
  receipt: 'progress',
  invoice: 'progress',
  customs: 'attention',
  other: 'neutral',
};

/**
 * The picker that files a loose document against a shipment.
 *
 * It offers only that customer's shipments. Staff *may* file a document
 * against anybody's — the server allows it, because a receipt occasionally
 * belongs to a parcel booked under a household member — but offering every
 * shipment in the business as a flat list would make the common case a
 * search through hundreds of options for one of two.
 */
function AttachPicker({ document: row, packages, busy, onAttach }) {
  const d = usePageText('documents');
  const theirs = packages.filter((pkg) => pkg.customer?.id === row.customer);

  if (theirs.length === 0) {
    // "None found" rather than "none exists": the picker is fed by one page
    // of shipments, so a customer whose parcels fall outside it would be
    // described wrongly by the stronger claim.
    return (
      <span className={styles.mutedCell}>{d('noneFound')}</span>
    );
  }

  return (
    <select
      className={styles.rowSelect}
      aria-label={d('fileLabel', { filename: row.filename })}
      value={row.package ?? ''}
      disabled={busy}
      onChange={(event) =>
        onAttach(row, event.target.value ? Number(event.target.value) : null)
      }
    >
      <option value="">{d('notFiled')}</option>
      {theirs.map((pkg) => (
        <option key={pkg.id} value={pkg.id}>
          {pkg.tracking_number}
          {pkg.description ? ` — ${pkg.description}` : ''}
        </option>
      ))}
    </select>
  );
}

export default function Documents() {
  const [params] = useSearchParams();
  const d = usePageText('documents');
  const c = usePageText('common');

  const list = useCollection(
    listDocuments,
    {
      kind: params.get('kind') ?? '',
      unattached: params.get('unattached') ?? '',
    },
    params.get('search') ?? '',
  );

  // The shipments the filing picker offers. Fetched once rather than per row:
  // every picker draws from the same list, and one request beats one per
  // document on the page.
  const [packages, setPackages] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let cancelled = false;

    // The API's ceiling, because this feeds pickers rather than a table. A
    // shipment beyond it is reported as "not found" by the row rather than
    // silently offering the wrong ones — see AttachPicker.
    listPackages({ page_size: 200 })
      .then((page) => {
        if (!cancelled) setPackages(page.results);
      })
      .catch(() => {
        // Not fatal: the documents still list, the pickers just cannot offer
        // anything, which the row above reports on its own.
        if (!cancelled) setPackages([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function attach(row, packageId) {
    setBusyId(row.id);
    setError('');
    setDone('');

    try {
      const saved = await attachDocument(row.id, packageId);
      list.replaceRow(saved);
      setDone(
        packageId ? d('filed', { tracking: saved.tracking_number }) : d('unfiled'),
      );
    } catch {
      setError(d('saveFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* data-tour hooks: this page's tour ("dashboardDocuments" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-documents-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Toolbar tour="db-documents-filters">
        <SearchInput
          value={list.searchInput}
          onChange={list.setSearchInput}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          label={d('kind')}
          value={list.filters.kind}
          onChange={(value) => list.setFilter('kind', value)}
          options={translatedOptions(DOCUMENT_KINDS, c, 'documentKind')}
          allLabel={d('anyKind')}
        />
        <FilterSelect
          label={d('filedFilter')}
          value={list.filters.unattached}
          onChange={(value) => list.setFilter('unattached', value)}
          options={[{ value: 'true', label: d('notFiled') }]}
          allLabel={d('allDocuments')}
        />
      </Toolbar>

      <Banner tone="error">{error}</Banner>
      <Banner tone="success">{done}</Banner>

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>
            {list.filters.unattached === 'true'
              ? d('allFiled')
              : d('noMatch')}
          </Empty>
        ) : (
          <div className={styles.tableWrap} data-tour="db-documents-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colFrom')}</th>
                  <th scope="col">{d('colWhat')}</th>
                  <th scope="col">{d('colFile')}</th>
                  <th scope="col">{d('colSent')}</th>
                  <th scope="col">{d('colShipment')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr
                    key={row.id}
                    // A document nobody has filed is the one thing on this
                    // page that is work, so it is marked the way an unhandled
                    // message is.
                    className={row.package ? undefined : styles.rowUnhandled}
                  >
                    <td>
                      <div className={styles.primaryCell}>{row.customer_name}</div>
                      {row.uploaded_by_name !== row.customer_name && (
                        <div className={styles.mutedCell}>
                          {d('uploadedBy', { name: row.uploaded_by_name })}
                        </div>
                      )}
                    </td>

                    <td>
                      <StatusBadge tone={KIND_TONES[row.kind]}>
                        {labelFor(c, 'documentKind', row.kind, row.kind_display)}
                      </StatusBadge>
                      {row.note && (
                        <div className={styles.mutedCell}>{row.note}</div>
                      )}
                    </td>

                    <td>
                      {/* Through the API view that checks the session, never
                          through /media: a receipt carries somebody's name,
                          address and what they paid. */}
                      <a
                        className={styles.link}
                        href={row.download_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.filename}
                      </a>
                      <div className={styles.mutedCell}>
                        {formatBytes(row.size_bytes)}
                      </div>
                    </td>

                    <td className={styles.dateCell}>
                      {formatDateTime(row.created_at)}
                    </td>

                    <td>
                      <AttachPicker
                        document={row}
                        packages={packages}
                        busy={busyId === row.id}
                        onAttach={attach}
                      />
                    </td>
                  </tr>
                ))}
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
