// src/components/ChatAssistant/ChatPanel.jsx
//
// The chat itself - the messages and the box to type in - shown inside the
// robot guide's panel (PageGuide) when the visitor picks "Ask our
// assistant". All the state and the sending live in ChatProvider; this is
// only the screen.

import { useEffect, useRef, useState } from 'react';
import { SendIcon } from '../Icons/icons';
import { useLanguage } from '../../i18n/useLanguage';
import { MAX_LENGTH } from './chatContext';
import { useChat } from './useChat';
import styles from './ChatPanel.module.css';

// The suggestions shown before the first message, by translation key.
// "Where is my parcel?" works for a signed-in customer (the server reads
// their own shipments); signed out, the assistant asks them to sign in.
const SUGGESTIONS = [
  'chat.suggestions.parcel',
  'chat.suggestions.costs',
  'chat.suggestions.booking',
  'chat.suggestions.how',
];

export default function ChatPanel() {
  const { t } = useLanguage();
  const { history, busy, errorKey, send } = useChat();
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Straight into the text box when the chat opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [history, busy]);

  function submit(text) {
    if (!text.trim() || busy) return;
    setDraft('');
    send(text);
  }

  function handleSubmit(event) {
    event.preventDefault();
    submit(draft);
  }

  // Enter sends, Shift+Enter starts a new line - as in every chat app.
  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(draft);
    }
  }

  const shown = history.filter((item) => item.role);

  return (
    <div className={styles.chat}>
      {/* aria-live: a screen reader reads each new answer as it arrives. */}
      <div className={styles.messages} ref={listRef} aria-live="polite">
        <p className={`${styles.bubble} ${styles.assistant}`}>{t('chat.welcome')}</p>

        {shown.length === 0 && (
          <div className={styles.suggestions}>
            {SUGGESTIONS.map((key) => (
              <button key={key} type="button" className={styles.suggestion} onClick={() => submit(t(key))}>
                {t(key)}
              </button>
            ))}
          </div>
        )}

        {shown.map((item, index) => (
          <p
            // The list only ever grows at the end, so the index is stable.
            key={index}
            className={`${styles.bubble} ${item.role === 'user' ? styles.user : styles.assistant}`}
          >
            {item.content}
          </p>
        ))}

        {busy && (
          <p className={`${styles.bubble} ${styles.assistant} ${styles.typing}`}>
            <span className={styles.srOnly}>{t('chat.thinking')}</span>
            <span aria-hidden="true">•••</span>
          </p>
        )}
        {errorKey && (
          <p className={styles.error} role="alert">
            {t(errorKey)}
          </p>
        )}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.srOnly} htmlFor="chat-input">
          {t('chat.placeholder')}
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className={styles.input}
          rows={1}
          maxLength={MAX_LENGTH}
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          className={styles.send}
          disabled={busy || !draft.trim()}
          aria-label={t('chat.send')}
        >
          <SendIcon size={20} />
        </button>
      </form>
      <p className={styles.disclaimer}>{t('chat.disclaimer')}</p>
    </div>
  );
}
