// src/pages/Dashboard/Quotes.jsx
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/quotes
//   Who can open: office staff
//   Links to:     nothing
//   Linked from:  the dashboard sidebar, Overview
//   Backend:      api/staff.js

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import HelpDialog from '../../components/HelpDialog/HelpDialog';
import { QUOTE_STATUSES, listQuotes, updateQuote } from '../../api/staff';
import { useCollection } from './useCollection';
import { formatDateTime } from './format';
import {
  Banner,
  Empty,
  FilterSelect,
  Pagination,
  SearchInput,
  StatusBadge,
  StatusSelect,
  Toolbar,
} from './ui';
import { Chip, Field, Group, Progress } from './sheet';
import QuoteAnswer from './QuoteAnswer';
import styles from './Dashboard.module.css';
import { labelFor, translatedOptions, usePageText } from './usePageText';

// A quote request's journey, for the progress line; "declined" ends it.
const QUOTE_STEPS = ['new', 'quoted', 'accepted'];

const QUOTE_TONES = {
  new: 'attention',
  quoted: 'progress',
  accepted: 'done',
  declined: 'off',
};

export default function Quotes() {
  // The overview's stat cards link here with ?status=new, so the filter reads
  // its starting value from the URL rather than always opening on "all".
  const [params] = useSearchParams();
  const d = usePageText('quotes');
  const c = usePageText('common');
  const statuses = translatedOptions(QUOTE_STATUSES, c, 'quoteStatus');

  const list = useCollection(
    listQuotes,
    { status: params.get('status') ?? '', destination: '' },
    params.get('search') ?? '',
  );

  // Which row is mid-save, and what went wrong if anything did.
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

  // Whose request is open in the panel under the table. One at a time: this is
  // somebody reading a request, not comparing two.
  const [openId, setOpenId] = useState(null);

  async function changeStatus(quote, status) {
    setSavingId(quote.id);
    setError('');

    try {
      // The server's version of the row, not a locally patched one: it also
      // carries updated_at and status_display.
      list.replaceRow(await updateQuote(quote.id, { status }));
    } catch {
      setError(c('changeFailed'));
    } finally {
      setSavingId(null);
    }
  }

  // Read off the rows rather than kept as a second copy, so a status change
  // shows in the panel the moment the table has it.
  const open = list.rows.find((quote) => quote.id === openId) ?? null;

  return (
    <>
      {/* data-tour hooks: this page's tour ("dashboardQuotes" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-quotes-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Toolbar tour="db-quotes-filters">
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
          options={statuses}
          allLabel={c('anyStatus')}
        />
      </Toolbar>

      <Banner tone="error">{error}</Banner>

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>{d('noMatch')}</Empty>
        ) : (
          <div className={styles.tableWrap} data-tour="db-quotes-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colRequestedBy')}</th>
                  <th scope="col">{d('colDestination')}</th>
                  <th scope="col">{d('colMessage')}</th>
                  <th scope="col">{d('colReceived')}</th>
                  <th scope="col">{c('status')}</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((quote) => (
                  <tr
                    key={quote.id}
                    className={[
                      styles.rowOpens,
                      quote.status === 'new' ? styles.rowUnhandled : '',
                      openId === quote.id ? styles.rowOpen : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    // Anywhere on the row opens it, as on the bookings table.
                    // A click that landed on the mailto, the attachment link
                    // or the status select is that control's own, so those are
                    // let through rather than swallowed.
                    onClick={(event) => {
                      if (event.target.closest('a, button, select, input, label')) {
                        return;
                      }
                      setOpenId((current) =>
                        current === quote.id ? null : quote.id,
                      );
                    }}
                  >
                    <td>
                      {/* The name is also a button: on a keyboard there is no
                          row to click, and this is what is reached instead. */}
                      <button
                        type="button"
                        className={styles.rowName}
                        aria-expanded={openId === quote.id}
                        onClick={() =>
                          setOpenId((current) =>
                            current === quote.id ? null : quote.id,
                          )
                        }
                      >
                        {quote.full_name}
                      </button>
                      <div className={styles.mutedCell}>
                        {/* mailto, because replying is what happens next. */}
                        <a className={styles.link} href={`mailto:${quote.email}`}>
                          {quote.email}
                        </a>
                      </div>
                    </td>

                    <td>
                      {quote.destination}
                      {quote.language && (
                        <div className={styles.mutedCell}>
                          {d('wroteIn', { language: quote.language.toUpperCase() })}
                        </div>
                      )}
                    </td>

                    <td>
                      <div className={styles.excerpt}>
                        {quote.message || <span className={styles.mutedCell}>—</span>}
                      </div>
                      {quote.file_url && (
                        <a
                          className={styles.link}
                          href={quote.file_url}
                          target="_blank"
                          // noreferrer as well as noopener: the attachment was
                          // uploaded by a member of the public.
                          rel="noreferrer"
                        >
                          {d('openAttachment')}
                        </a>
                      )}
                    </td>

                    <td className={styles.dateCell}>
                      {formatDateTime(quote.created_at)}
                    </td>

                    <td>
                      {/* The select is the status display as well as the
                          control — a badge beside it would say the same word
                          twice. The row stripe carries the urgency instead. */}
                      <StatusSelect
                        label={d('statusFor', { name: quote.full_name })}
                        value={quote.status}
                        options={statuses}
                        busy={savingId === quote.id}
                        onChange={(value) => changeStatus(quote, value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* The whole request in a pop-up over the list, as a contact message
          opens on the Messages page: the message is the part a cell clips,
          and the answer box needs the room. Escape, the × and a click outside
          close it (HelpDialog). Keyed by the row, so moving between two
          people rebuilds it - the answer box starts empty for each. */}
      {open && (
        <HelpDialog
          key={open.id}
          open
          wide
          onClose={() => setOpenId(null)}
          title={open.full_name}
          closeLabel={c('close')}
          doneLabel={c('close')}
        >

          {/* The same blue groups as an opened booking (sheet.jsx). */}
          <Group title={d('theRequest')}>
            <Field label={d('reference')}>
              {/* What the Django admin and a support conversation call this
                  request. Monospaced so it reads back accurately. */}
              <span className={styles.mono}>#{open.id}</span>
            </Field>
            <Field label={c('status')}>
              <StatusBadge tone={QUOTE_TONES[open.status]}>
                {labelFor(c, 'quoteStatus', open.status, open.status_display ?? open.status)}
              </StatusBadge>
            </Field>
            <Field label={d('received')}>{formatDateTime(open.created_at)}</Field>
            <Field label={d('lastChanged')}>{formatDateTime(open.updated_at)}</Field>
            <Field label={d('wroteInLabel')}>
              {open.language ? open.language.toUpperCase() : <Chip tone="off">{d('notKnown')}</Chip>}
            </Field>
            <Field label={c('progress')} wide>
              <Progress
                steps={QUOTE_STEPS.map((step) => [step, c(`quoteStatus.${step}`)])}
                status={open.status}
                stopped={{ declined: d('declined') }}
              />
            </Field>
          </Group>

          <Group title={d('contact')}>
            <Field label={d('name')}>{open.full_name}</Field>
            <Field label={c('email')}>
              <a className={styles.link} href={`mailto:${open.email}`}>
                {open.email}
              </a>
            </Field>
            <Field label={d('destination')}>{open.destination}</Field>
            <Field label={d('reply')}>
              {/* Opens the office's own mail program, addressed and with a
                  subject, so a reply is one click away. */}
              <a
                className={styles.bkAction}
                href={`mailto:${open.email}?subject=${encodeURIComponent(
                  d('replySubject', { id: open.id }),
                )}`}
              >
                {d('replyByEmail')}
              </a>
            </Field>
          </Group>

          <Group title={d('message')}>
            <Field label={d('whatTheyAsked')} wide>
              {/* Whole and unclipped, with the visitor's own line breaks: a
                  list typed one item per line is unreadable run together. */}
              {open.message ? (
                <div className={styles.bkQuote}>{open.message}</div>
              ) : (
                <Chip tone="off">{d('noMessage')}</Chip>
              )}
            </Field>
            <Field label={d('document')} wide>
              {open.file_url ? (
                <>
                  <a
                    className={styles.bkAction}
                    href={open.file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ↓ {open.file_name || d('attachment')}
                  </a>
                  {/* Said out loud, because the link looks like one that
                      would show the file and deliberately does not: an
                      attachment from a stranger is handed over as a download
                      rather than rendered in a tab. */}
                  <p className={styles.bkHint}>{d('downloadHint')}</p>
                </>
              ) : (
                <Chip tone="off">{d('nothingAttached')}</Chip>
              )}
            </Field>
          </Group>

          {/* The answers sent, and the box to write one (with "Write with AI"). */}
          <QuoteAnswer quote={open} onUpdated={list.replaceRow} d={d} />
        </HelpDialog>
      )}

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
