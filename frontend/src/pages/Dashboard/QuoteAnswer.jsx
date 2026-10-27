// src/pages/Dashboard/QuoteAnswer.jsx
//
// The "Answer" group in an opened quote request (Quotes.jsx): the answers
// sent so far, and a box to write the next one, with "Write with AI" for a
// first draft. The same arrangement as a contact message's reply box
// (Messages.jsx), and the same rules:
//   - Send e-mails the answer (backend enquiries/replies.py). The answer is
//     saved even when the e-mail fails, and the page says which happened.
//   - "Write with AI" only puts a draft in the box (assistant/drafts.py). The
//     price is left as [price] for the staff member to fill in. It is not
//     offered over text somebody typed by hand.
//
// Quotes.jsx keys the opened request by its id, so this component starts
// fresh - an empty box - for every request that is opened.

import { useState } from 'react';
import { draftReplyToQuote, replyToQuote } from '../../api/staff';
import { formatDateTime } from './format';
import { Banner } from './ui';
import { Chip, Field, Group } from './sheet';
import styles from './Dashboard.module.css';

/**
 * @param {{ quote: object, onUpdated: (quote: object) => void, d: Function }} props
 *   onUpdated: called with the request as the server returns it after a send.
 *   d: the Quotes page's text, usePageText('quotes').
 */
export default function QuoteAnswer({ quote, onUpdated, d }) {
  const a = (key, values) => d(`answer.${key}`, values);
  const [text, setText] = useState('');
  // 'idle' | 'sending' | 'sent' | 'failed'
  const [sendState, setSendState] = useState('idle');
  // 'idle' | 'drafting' | 'drafted' | 'failed'
  const [draftState, setDraftState] = useState('idle');

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSendState('sending');
    try {
      const updated = await replyToQuote(quote.id, body);
      onUpdated(updated);
      const newest = updated.replies?.[updated.replies.length - 1];
      if (newest?.sent) {
        setText('');
        setSendState('sent');
        setDraftState('idle');
      } else {
        // Keep the text, so pressing Send again is all it takes.
        setSendState('failed');
      }
    } catch {
      setSendState('failed');
    }
  }

  async function draft() {
    setDraftState('drafting');
    try {
      const { body } = await draftReplyToQuote(quote.id);
      setText(body);
      setSendState('idle');
      setDraftState('drafted');
    } catch {
      setDraftState('failed');
    }
  }

  const replies = quote.replies ?? [];

  return (
    <Group title={a('title')}>
      {replies.length > 0 && (
        <Field label={a('sentSoFar')} wide>
          <ol className={styles.replyList}>
            {replies.map((reply) => (
              <li key={reply.id} className={styles.replyItem}>
                <p className={styles.replyMeta}>
                  {reply.author_name || a('someone')} · {formatDateTime(reply.created_at)}{' '}
                  {reply.sent ? <Chip tone="good">{a('sent')}</Chip> : <Chip tone="bad">{a('notSent')}</Chip>}
                </p>
                <div className={styles.bkQuote}>{reply.body}</div>
              </li>
            ))}
          </ol>
        </Field>
      )}
      <Field label={a('write', { email: quote.email })} wide>
        <textarea
          className={styles.replyInput}
          rows={7}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (sendState !== 'sending') setSendState('idle');
            // Edited by hand: a new draft must not overwrite that.
            if (draftState === 'drafted') setDraftState('idle');
          }}
          placeholder={a('placeholder', { name: quote.first_name })}
          aria-label={a('write', { email: quote.email })}
        />
        <span className={styles.bkActions}>
          <button
            type="button"
            className={styles.bkAction}
            disabled={draftState === 'drafting' || sendState === 'sending' || (Boolean(text.trim()) && draftState !== 'drafted')}
            onClick={draft}
          >
            {draftState === 'drafting' ? a('drafting') : a('draftWithAi')}
          </button>
          <button
            type="button"
            className={`${styles.bkAction} ${styles.bkActionDone}`}
            disabled={sendState === 'sending' || !text.trim()}
            onClick={send}
          >
            {sendState === 'sending' ? a('sending') : a('send')}
          </button>
        </span>
        {draftState === 'drafted' && <Banner tone="info">{a('draftHint')}</Banner>}
        {draftState === 'failed' && <Banner tone="error">{a('draftFailed')}</Banner>}
        {sendState === 'sent' && <Banner tone="success">{a('sentBanner', { email: quote.email })}</Banner>}
        {sendState === 'failed' && <Banner tone="error">{a('failedBanner')}</Banner>}
      </Field>
    </Group>
  );
}
