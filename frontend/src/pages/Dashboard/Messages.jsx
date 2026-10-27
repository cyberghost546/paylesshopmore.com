// src/pages/Dashboard/Messages.jsx
//
// CONNECTED PAGES  (the whole map: docs/WEBSITE-MAP.md)
//   Address:      /dashboard/messages
//   Who can open: office staff
//   Links to:     nothing
//   Linked from:  the dashboard sidebar, Overview
//   Backend:      api/staff.js

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Loading from '../../components/Loading/Loading';
import ConnectionError from '../../components/ConnectionError/ConnectionError';
import HelpDialog from '../../components/HelpDialog/HelpDialog';
import { draftReplyToMessage, listMessages, replyToMessage, sortMessages, updateMessage } from '../../api/staff';
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
import { Chip, Field, Group } from './sheet';
import styles from './Dashboard.module.css';
import { usePageText } from './usePageText';

// Sent as strings, because a URL parameter is a string either way and the
// server reads "true"/"false" rather than guessing at "1" or "on".
const HANDLED_OPTIONS = [
  { value: 'false', key: 'notHandled' },
  { value: 'true', key: 'handled' },
];

// What the AI sorts a message as (backend enquiries/sorting.py). Labels in
// messages.sorting.topics.<value>.
const TOPICS = ['complaint', 'damage', 'tracking', 'price', 'booking', 'car', 'moving', 'payment', 'other', 'spam'];
// Urgent is the only one that needs to catch the eye.
// (The dashboard's badge tones: 'off' is its red.)
const URGENCY_TONES = { high: 'off', normal: 'neutral', low: 'neutral' };

export default function Messages() {
  // The sidebar's quick views and the overview's stat cards link in with a
  // filter already applied, so the page opens on it rather than on "all".
  const [params] = useSearchParams();
  const d = usePageText('messages');
  const c = usePageText('common');

  const list = useCollection(
    listMessages,
    // Urgent first by default: what the sorting is for.
    { handled: params.get('handled') ?? '', ai_topic: '', ordering: 'urgency' },
    params.get('search') ?? '',
  );

  // Messages the AI has not sorted yet (new ones, on a site without a
  // background worker): sorted once when the page shows them, then the list
  // is fetched again with their labels. Once per visit - if the AI is off,
  // they simply stay unsorted.
  const [sorting, setSorting] = useState(false);
  const sortTried = useRef(false);
  const hasUnsorted = list.rows.some((message) => !message.ai_sorted_at);
  const { reload } = list;
  useEffect(() => {
    if (!hasUnsorted || sortTried.current) return;
    sortTried.current = true;
    setSorting(true);
    sortMessages()
      .then(({ sorted }) => sorted > 0 && reload())
      .catch(() => {})
      .finally(() => setSorting(false));
  }, [hasUnsorted, reload]);

  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  // The message open in the pop-up, if any. Read off the rows rather than
  // kept as a copy, so "Mark handled" in the pop-up shows straight away.
  const [openId, setOpenId] = useState(null);
  const open = list.rows.find((message) => message.id === openId) ?? null;

  // The reply being typed in the pop-up, and how sending it went.
  //   replyState: 'idle' | 'sending' | 'sent' | 'failed'
  const [replyText, setReplyText] = useState('');
  const [replyState, setReplyState] = useState('idle');
  // "Write with AI": 'idle' | 'drafting' | 'drafted' | 'failed'.
  const [draftState, setDraftState] = useState('idle');
  // Which message the draft being written is for (see draftReply).
  const draftFor = useRef(null);

  /** Opens a message in the pop-up with an empty reply box. */
  function openMessage(id) {
    setOpenId(id);
    setReplyText('');
    setReplyState('idle');
    setDraftState('idle');
    draftFor.current = null;
  }

  /**
   * Puts an AI-written first draft in the reply box. Nothing is sent: the
   * staff member reads it, fixes it and presses Send as usual.
   */
  async function draftReply(message) {
    setDraftState('drafting');
    draftFor.current = message.id;
    try {
      const { body } = await draftReplyToMessage(message.id);
      // The pop-up may have moved on to another message while the AI wrote.
      if (draftFor.current !== message.id) return;
      setReplyText(body);
      setReplyState('idle');
      setDraftState('drafted');
    } catch {
      if (draftFor.current === message.id) setDraftState('failed');
    }
  }

  /**
   * Sends the reply typed in the pop-up (see enquiries/replies.py on the
   * server). The server saves the reply even when the e-mail fails, and
   * answers with the whole message, so we:
   *   1. put that message back in the list (shows the reply + "handled"),
   *   2. look at the newest reply's `sent` to say "sent" or "not sent".
   */
  async function sendReply(message) {
    const body = replyText.trim();
    if (!body) return;
    setReplyState('sending');
    try {
      const updated = await replyToMessage(message.id, body);
      list.replaceRow(updated);
      const newest = updated.replies?.[updated.replies.length - 1];
      if (newest?.sent) {
        setReplyText('');
        setReplyState('sent');
      } else {
        // Keep the text, so pressing Send again is all it takes.
        setReplyState('failed');
      }
    } catch {
      setReplyState('failed');
    }
  }

  async function setHandled(message, handled) {
    setSavingId(message.id);
    setError('');

    try {
      list.replaceRow(await updateMessage(message.id, { handled }));
    } catch {
      setError(c('changeFailed'));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      {/* data-tour hooks: this page's tour ("dashboardMessages" in
          components/Tutorial/tutorialSteps.js) points at these. */}
      <header className={styles.head} data-tour="db-messages-intro">
        <h1 className={styles.title}>{d('title')}</h1>
        <p className={styles.subtitle}>{d('subtitle')}</p>
      </header>

      <Toolbar tour="db-messages-filters">
        <SearchInput
          value={list.searchInput}
          onChange={list.setSearchInput}
          label={d('searchLabel')}
          placeholder={d('searchPlaceholder')}
        />
        <FilterSelect
          label={d('handled')}
          value={list.filters.handled}
          onChange={(value) => list.setFilter('handled', value)}
          options={HANDLED_OPTIONS.map((option) => ({ value: option.value, label: d(option.key) }))}
          allLabel={d('allMessages')}
        />
        <FilterSelect
          label={d('sorting.topic')}
          value={list.filters.ai_topic}
          onChange={(value) => list.setFilter('ai_topic', value)}
          options={TOPICS.map((value) => ({ value, label: d(`sorting.topics.${value}`) }))}
          allLabel={d('sorting.allTopics')}
        />
        <label className={styles.filter}>
          <span className={styles.filterLabel}>{d('sorting.order')}</span>
          <select
            className={styles.select}
            value={list.filters.ordering}
            onChange={(event) => list.setFilter('ordering', event.target.value)}
          >
            <option value="urgency">{d('sorting.urgentFirst')}</option>
            <option value="-created_at">{d('sorting.newestFirst')}</option>
          </select>
        </label>
      </Toolbar>

      {sorting && <p className={styles.mutedCell}>{d('sorting.sorting')}</p>}

      <Banner tone="error">{error}</Banner>

      {list.state === 'loading' && <Loading inline />}
      {list.state === 'error' && <ConnectionError inline onRetry={list.reload} />}

      {list.state === 'ready' &&
        (list.rows.length === 0 ? (
          <Empty>{d('noMatch')}</Empty>
        ) : (
          <div className={styles.tableWrap} data-tour="db-messages-table">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{d('colFrom')}</th>
                  <th scope="col">{d('colSubject')}</th>
                  <th scope="col">{d('colMessage')}</th>
                  <th scope="col">{d('colReceived')}</th>
                  <th scope="col">
                    <span className={styles.srOnly}>{d('colActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((message) => {
                  const isOpen = openId === message.id;

                  return (
                    <tr
                      key={message.id}
                      className={[
                        styles.rowOpens,
                        message.handled ? '' : styles.rowUnhandled,
                        isOpen ? styles.rowOpen : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      // Anywhere on the row opens the message in a pop-up. A
                      // click that landed on the mailto or on "Mark handled"
                      // is that control's own, so those are let through
                      // rather than swallowed.
                      onClick={(event) => {
                        if (event.target.closest('a, button, select, input, label')) {
                          return;
                        }
                        openMessage(message.id);
                      }}
                    >
                      <td>
                        <div className={styles.primaryCell}>{message.name}</div>
                        <div className={styles.mutedCell}>
                          <a className={styles.link} href={`mailto:${message.email}`}>
                            {message.email}
                          </a>
                        </div>
                      </td>

                      <td>
                        {message.subject}
                        {/* The AI's sorting: urgency and topic. Spam and
                            "can wait" are muted rather than hidden - every
                            message stays in the list. */}
                        {message.ai_sorted_at && (
                          <div className={styles.sortChips} title={d('sorting.aiLabel')}>
                            {message.ai_urgency !== 'normal' && (
                              <StatusBadge tone={URGENCY_TONES[message.ai_urgency]}>
                                {d(`sorting.urgency.${message.ai_urgency}`)}
                              </StatusBadge>
                            )}
                            <StatusBadge tone="neutral">{d(`sorting.topics.${message.ai_topic}`)}</StatusBadge>
                          </div>
                        )}
                        {message.language && (
                          <div className={styles.mutedCell}>
                            {d('wroteIn', { language: message.language.toUpperCase() })}
                          </div>
                        )}
                      </td>

                      <td>
                        {/* Clamped to two lines; the whole message opens in a
                            pop-up. Never dangerouslySetInnerHTML - a stranger
                            wrote this text. */}
                        {/* The AI's one-line summary, when there is one,
                            above the message itself. */}
                        {message.ai_summary && <div className={styles.sortSummary}>{message.ai_summary}</div>}
                        <div className={styles.excerpt}>{message.message}</div>
                        <button
                          type="button"
                          className={styles.linkButton}
                          aria-haspopup="dialog"
                          onClick={() => openMessage(message.id)}
                        >
                          {d('readAll')}
                        </button>
                      </td>

                      <td className={styles.dateCell}>
                        {formatDateTime(message.created_at)}
                      </td>

                      <td>
                        <button
                          type="button"
                          className={
                            message.handled
                              ? `${styles.rowButton} ${styles.rowButtonDone}`
                              : styles.rowButton
                          }
                          disabled={savingId === message.id}
                          onClick={() => setHandled(message, !message.handled)}
                        >
                          {message.handled ? d('isHandled') : d('markHandled')}
                        </button>
                        {/* "↩ Replied" once somebody answered it from here. */}
                        {message.replies?.some((reply) => reply.sent) && (
                          <div className={styles.mutedCell}>{d('replied')}</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {/* The whole message, in a pop-up: in the same blue groups as an
          opened booking or quote (sheet.jsx), with the sender's own line
          breaks kept. */}
      {open && (
        <HelpDialog
          open
          wide
          onClose={() => setOpenId(null)}
          title={open.subject || d('message')}
          closeLabel={c('close')}
          doneLabel={c('close')}
        >
          <Group title={d('from')}>
            <Field label={d('name')}>{open.name}</Field>
            <Field label={c('email')}>
              <a className={styles.link} href={`mailto:${open.email}`}>
                {open.email}
              </a>
            </Field>
            <Field label={d('received')}>{formatDateTime(open.created_at)}</Field>
            <Field label={d('wroteInLabel')}>
              {open.language ? open.language.toUpperCase() : <Chip tone="off">{d('notKnown')}</Chip>}
            </Field>
          </Group>

          <Group title={d('message')}>
            <Field label={d('subject')} wide>
              {open.subject || <Chip tone="off">{d('noSubject')}</Chip>}
            </Field>
            <Field label={d('whatTheyWrote')} wide>
              <div className={styles.bkQuote}>{open.message}</div>
            </Field>
            <Field label={d('actions')} wide>
              <span className={styles.bkActions}>
                {/* Opens the office's own mail program, addressed and with
                    "Re:" and the subject, so a reply is one click away. */}
                <a
                  className={styles.bkAction}
                  href={`mailto:${open.email}?subject=${encodeURIComponent(
                    `Re: ${open.subject || d('yourMessage')}`,
                  )}`}
                >
                  {d('replyByEmail')}
                </a>
                <button
                  type="button"
                  className={
                    open.handled ? `${styles.bkAction} ${styles.bkActionDone}` : styles.bkAction
                  }
                  disabled={savingId === open.id}
                  onClick={() => setHandled(open, !open.handled)}
                >
                  {open.handled ? d('isHandled') : d('markHandled')}
                </button>
              </span>
            </Field>
          </Group>

          {/* The answers sent from here, oldest first, and a box to write a
              new one. The e-mail goes to the sender, with their message
              quoted below it (enquiries/replies.py). */}
          <Group title={d('replies')}>
            {open.replies?.length > 0 && (
              <Field label={d('sentReplies')} wide>
                <ol className={styles.replyList}>
                  {open.replies.map((reply) => (
                    <li key={reply.id} className={styles.replyItem}>
                      <p className={styles.replyMeta}>
                        {reply.author_name || d('someone')} · {formatDateTime(reply.created_at)}{' '}
                        {reply.sent ? (
                          <Chip tone="good">{d('replySent')}</Chip>
                        ) : (
                          <Chip tone="bad">{d('replyNotSent')}</Chip>
                        )}
                      </p>
                      <div className={styles.bkQuote}>{reply.body}</div>
                    </li>
                  ))}
                </ol>
              </Field>
            )}
            <Field label={d('writeReply', { email: open.email })} wide>
              <textarea
                className={styles.replyInput}
                rows={6}
                value={replyText}
                onChange={(event) => {
                  setReplyText(event.target.value);
                  if (replyState !== 'sending') setReplyState('idle');
                  // Edited by hand: a new draft must not overwrite that.
                  if (draftState === 'drafted') setDraftState('idle');
                }}
                placeholder={d('replyPlaceholder', { name: open.name })}
                aria-label={d('writeReply', { email: open.email })}
              />
              <span className={styles.bkActions}>
                {/* A first draft by AI into the box above (never sent by
                    itself). Replaces what is typed, so only offered while
                    the box is empty or holds the last draft. */}
                <button
                  type="button"
                  className={styles.bkAction}
                  disabled={
                    draftState === 'drafting' ||
                    replyState === 'sending' ||
                    (Boolean(replyText.trim()) && draftState !== 'drafted')
                  }
                  onClick={() => draftReply(open)}
                >
                  {draftState === 'drafting' ? d('drafting') : d('draftWithAi')}
                </button>
                <button
                  type="button"
                  className={`${styles.bkAction} ${styles.bkActionDone}`}
                  disabled={replyState === 'sending' || !replyText.trim()}
                  onClick={() => sendReply(open)}
                >
                  {replyState === 'sending' ? d('sendingReply') : d('sendReply')}
                </button>
              </span>
              {draftState === 'drafted' && <Banner tone="info">{d('draftHint')}</Banner>}
              {draftState === 'failed' && <Banner tone="error">{d('draftFailed')}</Banner>}
              {replyState === 'sent' && <Banner tone="success">{d('replySentBanner', { email: open.email })}</Banner>}
              {replyState === 'failed' && <Banner tone="error">{d('replyFailedBanner')}</Banner>}
            </Field>
          </Group>
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
