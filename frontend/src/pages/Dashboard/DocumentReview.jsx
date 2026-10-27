// src/pages/Dashboard/DocumentReview.jsx
//
// READ THIS FIRST
// ---------------
// "Document review": the queue of documents the AI has read (backend
// docreview/). Every incoming document - a customer's receipt, a booking
// attachment, an e-mail, a staff upload, a warehouse label photo - becomes a
// "job". The AI reads it, the server looks the details up in our records, and:
//
//   - a reliable match is linked by itself         -> status "Linked"
//   - anything uncertain waits here for a person   -> status "Needs review"
//   - a document that could not be read            -> status "Failed"
//
// This page lists the jobs (the open ones first) and lets staff upload a
// document to be read. Opening a job shows the document next to what was read
// and what it was matched to, with the buttons to fix it - that part is
// DocumentJobPanel.jsx.
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/document-review
//   Who can open: office staff
//   Links to:     nothing
//   Linked from:  the dashboard sidebar
//   Backend:      api/staff.js (listDocumentJobs and friends)

import { useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import { listDocumentJobs, uploadDocumentForReview } from '../../api/staff';
import { useCollection } from './useCollection';
import { formatDateTime } from './format';
import { Banner, Empty, FilterSelect, Pagination, SearchInput, StatusBadge, Toolbar } from './ui';
import { usePageText } from './usePageText';
import { DOCUMENT_JOB_TONES as JOB_TONES } from './statuses';
import DocumentJobPanel from './DocumentJobPanel';
import styles from './Dashboard.module.css';

const STATUSES = ['needs_review', 'failed', 'linked', 'resolved', 'queued', 'processing'];
const SOURCES = ['customer_document', 'booking_attachment', 'email', 'staff_upload', 'warehouse_photo'];

/** Upload a document to be read: a file and an optional note. */
function UploadForm({ onUploaded, d }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const job = await uploadDocumentForReview(file, note.trim());
      setFile(null);
      setNote('');
      if (input.current) input.current.value = '';
      onUploaded(job);
    } catch (err) {
      setError(err?.fields?.file?.[0] ?? err?.fields?.file ?? d('uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.docUpload} onSubmit={upload}>
      <div className={styles.docUploadField}>
        <span>{d('uploadLabel')}</span>
        {/* The browser's own file box ("Choose File  No file chosen") looks
            different in every browser and matches nothing else on the page,
            so it is hidden behind a dashboard-style button and the chosen
            file's name - the same pattern as the invoices' PDF upload. */}
        <div className={styles.docFilePick}>
          <label className={styles.uploadButton}>
            <input
              ref={input}
              type="file"
              className={styles.uploadInput}
              aria-label={d('uploadLabel')}
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {d('chooseFile')}
          </label>
          <span className={file ? styles.docFileName : styles.docNoFile}>{file ? file.name : d('noFile')}</span>
        </div>
      </div>
      <label className={styles.docUploadField}>
        <span>{d('noteLabel')}</span>
        <input
          type="text"
          className={styles.searchInput}
          value={note}
          maxLength={255}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button type="submit" className={styles.rowButton} disabled={!file || busy}>
        {busy ? d('uploading') : d('upload')}
      </button>
      <Banner tone="error">{error}</Banner>
    </form>
  );
}

export default function DocumentReview() {
  const d = usePageText('documentReview');
  const [params] = useSearchParams();
  // The sidebar's pill counts open jobs; reload refreshes it after a change.
  const outlet = useOutletContext() ?? {};
  const list = useCollection(
    listDocumentJobs,
    { status: params.get('status') ?? 'needs_review', source: '' },
    params.get('search') ?? '',
  );
  const [openId, setOpenId] = useState(params.get('open') ? Number(params.get('open')) : null);

  function afterChange() {
    list.reload();
    outlet.reload?.();
  }

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <UploadForm
        d={d}
        onUploaded={(job) => {
          afterChange();
          setOpenId(job.id);
        }}
      />

      <Toolbar>
        <SearchInput
          value={list.searchInput}
          onChange={list.setSearchInput}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          label={d('statusLabel')}
          value={list.filters.status}
          onChange={(value) => list.setFilter('status', value)}
          options={STATUSES.map((value) => ({ value, label: d(`status.${value}`) }))}
          allLabel={d('allStatuses')}
        />
        <FilterSelect
          label={d('sourceLabel')}
          value={list.filters.source}
          onChange={(value) => list.setFilter('source', value)}
          options={SOURCES.map((value) => ({ value, label: d(`source.${value}`) }))}
          allLabel={d('allSources')}
        />
      </Toolbar>

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>{d('empty')}</Empty>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colReceived')}</th>
                  <th scope="col">{d('colDocument')}</th>
                  <th scope="col">{d('colStatus')}</th>
                  <th scope="col">{d('colLinked')}</th>
                  <th scope="col">
                    <span className={styles.srOnly}>{d('colActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((job) => (
                  <tr
                    key={job.id}
                    className={styles.rowOpens}
                    onClick={(event) => {
                      if (!event.target.closest('button, a')) setOpenId(job.id);
                    }}
                  >
                    <td className={styles.dateCell}>{formatDateTime(job.created_at)}</td>
                    <td>
                      <div className={styles.primaryCell}>{job.original_name || d('noName')}</div>
                      <div className={styles.mutedCell}>
                        {d(`source.${job.source}`)}
                        {job.summary ? ` · ${job.summary}` : ''}
                      </div>
                    </td>
                    <td>
                      <StatusBadge tone={JOB_TONES[job.status] ?? 'neutral'}>{d(`status.${job.status}`)}</StatusBadge>
                      {job.auto_linked && <div className={styles.mutedCell}>{d('automatic')}</div>}
                      {job.reasons > 0 && job.status === 'needs_review' && (
                        <div className={styles.mutedCell}>{d('reasonCount', { count: job.reasons })}</div>
                      )}
                    </td>
                    <td>
                      <div>{job.package_label || '—'}</div>
                      <div className={styles.mutedCell}>{job.customer_label}</div>
                    </td>
                    <td>
                      <button type="button" className={styles.rowButton} onClick={() => setOpenId(job.id)}>
                        {d('open')}
                      </button>
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

      {openId && <DocumentJobPanel jobId={openId} onClose={() => setOpenId(null)} onChanged={afterChange} />}
    </>
  );
}
