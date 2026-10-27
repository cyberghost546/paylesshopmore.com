// src/pages/Dashboard/DocumentJobPanel.jsx
//
// READ THIS FIRST
// ---------------
// One document job, opened from the Document review list (DocumentReview.jsx).
// Left: the original document. Right, top to bottom:
//
//   1. Status, and the reasons a person has to look (from the server).
//   2. What was read: the fields, with "Edit fields" to correct them. A
//      correction needs a reason; the server re-checks and looks the records
//      up again afterwards.
//   3. Matches, per kind of record (customer, shipment, shop order, invoice):
//      what the server proposes and why, which one is selected, buttons to
//      use or reject a proposal, and a search box to pick any existing record.
//   4. Actions: Confirm and link / Retry reading / Mark resolved.
//   5. History: every reading attempt and every change, with who and when.
//
// The page never decides anything itself: every button calls the server
// (docreview/pipeline.py), which checks the records again and answers with
// the whole job, which is then shown. So what you see is always what the
// server holds.

import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../../api/client';
import {
  confirmDocumentJob,
  editDocumentFields,
  getDocumentJob,
  rejectDocumentMatch,
  resolveDocumentJob,
  retryDocumentJob,
  searchDocumentCandidates,
  selectDocumentMatch,
} from '../../api/staff';
import HelpDialog from '../../components/HelpDialog/HelpDialog';
import Loading from '../../components/Loading/Loading';
import { formatDateTime } from './format';
import { Chip, Field, Group } from './sheet';
import { DOCUMENT_JOB_TONES } from './statuses';
import { Banner, StatusBadge } from './ui';
import { usePageText } from './usePageText';
import styles from './Dashboard.module.css';

const ENTITIES = ['customer', 'package', 'order', 'invoice'];
// The fields shown (and editable), in reading order. List fields are typed
// as "A, B" in the edit form.
const FIELDS = [
  'document_type',
  'customer_name',
  'customer_email',
  'customer_code',
  'shipment_numbers',
  'carrier_name',
  'carrier_tracking_numbers',
  'shop_name',
  'order_number',
  'invoice_number',
  'invoice_date',
  'total_amount',
  'currency',
];
const LIST_FIELDS = new Set(['shipment_numbers', 'carrier_tracking_numbers']);
const OPEN_STATUSES = new Set(['needs_review', 'failed', 'linked']);

/** The server's own sentence for a refusal, or a general one. */
function problem(err, fallback) {
  return err?.fields?.detail ?? fallback;
}

function show(value) {
  if (Array.isArray(value)) return value.join(', ');
  return value || '';
}

/**
 * The original document. Fetched with the staff session (it is never on a
 * public address) and shown from a temporary blob: URL.
 */
function Preview({ job, d }) {
  const [state, setState] = useState({ url: null, failed: false });

  useEffect(() => {
    if (job.content_type === 'text/plain') return undefined;
    let url = null;
    let live = true;
    fetch(apiUrl(`/staff/document-jobs/${job.id}/file/`), { credentials: 'include' })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('failed'))))
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setState({ url, failed: false });
      })
      .catch(() => live && setState({ url: null, failed: true }));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [job.id, job.content_type]);

  // An e-mail without attachments: its text is the document. Shown as text,
  // never as HTML - a stranger wrote it.
  if (job.content_type === 'text/plain') {
    return <pre className={styles.docText}>{job.source_meta?.body || job.text}</pre>;
  }
  if (state.failed) return <Banner tone="error">{d('previewFailed')}</Banner>;
  if (!state.url) return <Loading inline />;
  if (job.content_type === 'application/pdf') {
    return <object className={styles.docPreviewFrame} data={state.url} type="application/pdf" aria-label={d('preview')} />;
  }
  return <img className={styles.docPreviewImage} src={state.url} alt={d('preview')} />;
}

/** The fields that were read, and the form to correct them. */
function Fields({ job, busy, onSave, d }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState('');
  const extracted = job.extracted ?? {};
  const issuesByField = {};
  for (const item of job.validation ?? []) {
    (issuesByField[item.field] ??= []).push(item.message);
  }

  function start() {
    setValues(Object.fromEntries(FIELDS.map((field) => [field, show(extracted[field])])));
    setReason('');
    setEditing(true);
  }

  async function save() {
    // Only what was actually changed is sent, so the audit log is precise.
    const changes = {};
    for (const field of FIELDS) {
      if (values[field] !== show(extracted[field])) {
        changes[field] = LIST_FIELDS.has(field)
          ? values[field].split(',').map((part) => part.trim()).filter(Boolean)
          : values[field];
      }
    }
    const ok = await onSave(changes, reason.trim());
    if (ok) setEditing(false);
  }

  return (
    <Group title={d('readTitle')}>
      {FIELDS.map((field) => (
        <Field key={field} label={d(`field.${field}`)}>
          {editing ? (
            <input
              className={styles.docInput}
              value={values[field] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
              aria-label={d(`field.${field}`)}
            />
          ) : (
            <>
              {show(extracted[field]) || <Chip tone="off">{d('notFound')}</Chip>}
              {job.human_fields?.includes(field) && <> <Chip tone="good">{d('correctedByPerson')}</Chip></>}
            </>
          )}
          {issuesByField[field]?.map((message) => (
            <p key={message} className={styles.docIssue}>
              {message}
            </p>
          ))}
        </Field>
      ))}
      <Field label={d('actions')} wide>
        {editing ? (
          <div className={styles.docActionRow}>
            <input
              className={styles.docInput}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={d('reasonPlaceholder')}
              aria-label={d('correctionReason')}
            />
            <button type="button" className={styles.bkAction} disabled={busy || !reason.trim()} onClick={save}>
              {d('saveFields')}
            </button>
            <button type="button" className={styles.bkAction} onClick={() => setEditing(false)}>
              {d('cancel')}
            </button>
          </div>
        ) : (
          <button type="button" className={styles.bkAction} disabled={busy || !OPEN_STATUSES.has(job.status)} onClick={start}>
            {d('editFields')}
          </button>
        )}
      </Field>
    </Group>
  );
}

/** Proposals, the current choice and a search box, for one kind of record. */
function Matches({ job, entity, busy, onSelect, onReject, d }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const proposals = job.proposals?.[entity] ?? [];
  const selected = job.selected?.[entity];
  const locked = entity === 'invoice' && !job.can_link_invoice;
  const editable = OPEN_STATUSES.has(job.status) && !busy;

  async function find(event) {
    event.preventDefault();
    try {
      setResults(await searchDocumentCandidates(job.id, entity, query));
    } catch {
      setResults([]);
    }
  }

  return (
    <div className={styles.docEntity}>
      <p className={styles.docEntityHead}>
        <strong>{d(`entity.${entity}`)}</strong>{' '}
        {selected ? (
          <span>
            {d('selected')}: {job.selected_labels?.[entity]}{' '}
            {editable && !locked && (
              <button type="button" className={styles.linkButton} onClick={() => onSelect(entity, null)}>
                {d('clear')}
              </button>
            )}
          </span>
        ) : (
          <Chip tone="off">{d('nothingSelected')}</Chip>
        )}
      </p>
      {locked && <p className={styles.bkHint}>{d('invoiceAdminOnly')}</p>}

      {proposals.length > 0 && (
        <ul className={styles.docProposals}>
          {proposals.map((proposal) => (
            <li key={proposal.id} className={proposal.id === selected ? styles.docProposalChosen : undefined}>
              <span>
                {proposal.label}{' '}
                <Chip tone={proposal.strong ? 'good' : 'bad'}>{proposal.strong ? d('strong') : d('weak')}</Chip>
              </span>
              <span className={styles.mutedCell}>{proposal.reasons.join(' · ')}</span>
              {editable && !locked && (
                <span className={styles.docActionRow}>
                  {proposal.id !== selected && (
                    <button type="button" className={styles.linkButton} onClick={() => onSelect(entity, proposal.id)}>
                      {d('useThis')}
                    </button>
                  )}
                  <button type="button" className={styles.linkButton} onClick={() => setRejecting(proposal.id)}>
                    {d('wrong')}
                  </button>
                </span>
              )}
              {rejecting === proposal.id && (
                <span className={styles.docActionRow}>
                  <input
                    className={styles.docInput}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={d('reasonPlaceholder')}
                    aria-label={d('rejectReason')}
                  />
                  <button
                    type="button"
                    className={styles.bkAction}
                    disabled={!reason.trim()}
                    onClick={async () => {
                      await onReject(entity, proposal.id, reason.trim());
                      setRejecting(null);
                      setReason('');
                    }}
                  >
                    {d('rejectMatch')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && !locked && (
        <form className={styles.docActionRow} onSubmit={find}>
          <input
            className={styles.docInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={d(`searchEntity.${entity}`)}
            aria-label={d(`searchEntity.${entity}`)}
          />
          <button type="submit" className={styles.bkAction}>
            {d('find')}
          </button>
        </form>
      )}
      {results && (
        <ul className={styles.docProposals}>
          {results.length === 0 && <li className={styles.mutedCell}>{d('noResults')}</li>}
          {results.map((record) => (
            <li key={record.id}>
              <span>{record.label}</span>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => {
                  onSelect(entity, record.id);
                  setResults(null);
                }}
              >
                {d('useThis')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every attempt and every change, oldest first. */
function History({ job, d }) {
  return (
    <Group title={d('historyTitle')}>
      <Field label={d('attempts')} wide>
        {job.attempts.length === 0 ? (
          <Chip tone="off">{d('noAttempts')}</Chip>
        ) : (
          <ol className={styles.docHistory}>
            {job.attempts.map((attempt) => (
              <li key={attempt.number}>
                {d('attemptLine', { number: attempt.number, when: formatDateTime(attempt.started_at) })}{' '}
                <Chip tone={attempt.ok ? 'good' : 'bad'}>{attempt.ok ? d('attemptOk') : d('attemptFailed')}</Chip>
                {attempt.error && <span className={styles.mutedCell}> {attempt.error}</span>}
                {attempt.requested_by && <span className={styles.mutedCell}> · {attempt.requested_by}</span>}
              </li>
            ))}
          </ol>
        )}
      </Field>
      <Field label={d('changes')} wide>
        <ol className={styles.docHistory}>
          {job.events.map((event) => (
            <li key={event.id}>
              <span className={styles.mutedCell}>{formatDateTime(event.created_at)}</span>{' '}
              <strong>{d(`action.${event.action}`)}</strong> · {event.actor || d('system')}
              {event.field && (
                <span className={styles.mutedCell}>
                  {' '}
                  · {event.field}: {JSON.stringify(event.before)} → {JSON.stringify(event.after)}
                </span>
              )}
              {event.reason && <div className={styles.mutedCell}>“{event.reason}”</div>}
            </li>
          ))}
        </ol>
      </Field>
    </Group>
  );
}

export default function DocumentJobPanel({ jobId, onClose, onChanged }) {
  const d = usePageText('documentReview');
  const [job, setJob] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: 'info', text: '' });
  const [reason, setReason] = useState('');

  useEffect(() => {
    let live = true;
    getDocumentJob(jobId)
      .then((data) => live && setJob(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [jobId]);

  // While the document is still being read (on the worker), look again every
  // few seconds, so the page shows the result without a refresh.
  const reading = job && (job.status === 'queued' || job.status === 'processing');
  useEffect(() => {
    if (!reading) return undefined;
    const timer = window.setTimeout(() => {
      getDocumentJob(jobId)
        .then((data) => {
          setJob(data);
          if (data.status !== 'queued' && data.status !== 'processing') onChanged?.();
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [reading, job, jobId, onChanged]);

  /** Run one action: show the job the server answers with, or its refusal. */
  const run = useCallback(
    async (call, doneText) => {
      setBusy(true);
      setMessage({ tone: 'info', text: '' });
      try {
        setJob(await call());
        if (doneText) setMessage({ tone: 'success', text: doneText });
        onChanged?.();
        return true;
      } catch (err) {
        setMessage({ tone: 'error', text: problem(err, d('actionFailed')) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [d, onChanged],
  );

  const title = job ? job.original_name || d('noName') : d('loadingTitle');
  const open = job && OPEN_STATUSES.has(job.status);

  return (
    <HelpDialog open extraWide onClose={onClose} title={title} closeLabel={d('close')} doneLabel={d('close')}>
      {failed && <Banner tone="error">{d('loadFailed')}</Banner>}
      {!job && !failed && <Loading inline />}
      {job && (
        <div className={styles.docLayout}>
          <div className={styles.docPreview}>
            <Preview job={job} d={d} />
            {job.source_meta?.subject && (
              <div className={styles.docMeta}>
                <p>
                  <strong>{d('emailFrom')}:</strong> {job.source_meta.from}
                </p>
                <p>
                  <strong>{d('emailSubject')}:</strong> {job.source_meta.subject}
                </p>
              </div>
            )}
            {job.text && (
              <details className={styles.docMeta}>
                <summary>{d('ocrText')}</summary>
                <pre className={styles.docText}>{job.text}</pre>
              </details>
            )}
          </div>

          <div className={styles.docDetails}>
            <Group title={d('statusTitle')}>
              <Field label={d('colStatus')}>
                <StatusBadge tone={DOCUMENT_JOB_TONES[job.status] ?? 'neutral'}>{d(`status.${job.status}`)}</StatusBadge>
                {job.auto_linked && <> <Chip tone="good">{d('automatic')}</Chip></>}
              </Field>
              <Field label={d('sourceLabel')}>{d(`source.${job.source}`)}</Field>
              <Field label={d('documentType')}>{job.extracted?.document_type ? d(`type.${job.extracted.document_type}`) : '—'}</Field>
              <Field label={d('summary')}>{job.summary || '—'}</Field>
              {job.last_error && (
                <Field label={d('lastError')} wide>
                  <span className={styles.docIssue}>{job.last_error}</span>
                </Field>
              )}
              {job.review_reasons?.length > 0 && job.status !== 'linked' && (
                <Field label={d('whyReview')} wide>
                  <ul className={styles.docReasons}>
                    {job.review_reasons.map((item) => (
                      <li key={`${item.code}-${item.message}`}>{item.message}</li>
                    ))}
                  </ul>
                </Field>
              )}
            </Group>

            <Banner tone={message.tone}>{message.text}</Banner>

            <Fields
              job={job}
              busy={busy}
              d={d}
              onSave={(changes, why) => run(() => editDocumentFields(job.id, changes, why), d('fieldsSaved'))}
            />

            <Group title={d('matchesTitle')}>
              <Field label={d('matchesHint')} wide>
                {ENTITIES.map((entity) => (
                  <Matches
                    key={entity}
                    job={job}
                    entity={entity}
                    busy={busy}
                    d={d}
                    onSelect={(kind, id) => run(() => selectDocumentMatch(job.id, kind, id))}
                    onReject={(kind, id, why) => run(() => rejectDocumentMatch(job.id, kind, id, why), d('rejected'))}
                  />
                ))}
              </Field>
              {job.status === 'linked' && (
                <Field label={d('linkedTitle')} wide>
                  <ul className={styles.docReasons}>
                    {ENTITIES.filter((entity) => job.links?.[entity]).map((entity) => (
                      <li key={entity}>
                        {d(`entity.${entity}`)}: {job.links[entity].label}
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
            </Group>

            {open && (
              <Group title={d('actions')}>
                <Field label={d('reasonLabel')} wide>
                  <input
                    className={styles.docInput}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={d('reasonPlaceholder')}
                    aria-label={d('reasonLabel')}
                  />
                  <span className={styles.bkHint}>{d('reasonHint')}</span>
                </Field>
                <Field label={d('actions')} wide>
                  <span className={styles.bkActions}>
                    <button
                      type="button"
                      className={`${styles.bkAction} ${styles.bkActionDone}`}
                      disabled={busy || Object.keys(job.selected ?? {}).length === 0}
                      onClick={() => run(() => confirmDocumentJob(job.id, reason.trim()), d('confirmed'))}
                    >
                      {job.status === 'linked' ? d('saveLinks') : d('confirm')}
                    </button>
                    {job.status !== 'linked' && (
                      <button
                        type="button"
                        className={styles.bkAction}
                        disabled={busy}
                        onClick={() => run(() => retryDocumentJob(job.id), d('retryStarted'))}
                      >
                        {d('retry')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.bkAction}
                      disabled={busy || !reason.trim()}
                      onClick={() => run(() => resolveDocumentJob(job.id, reason.trim()), d('resolvedDone'))}
                    >
                      {d('resolve')}
                    </button>
                  </span>
                </Field>
              </Group>
            )}

            <History job={job} d={d} />
          </div>
        </div>
      )}
    </HelpDialog>
  );
}
