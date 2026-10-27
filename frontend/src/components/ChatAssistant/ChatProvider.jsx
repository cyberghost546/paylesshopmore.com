// src/components/ChatAssistant/ChatProvider.jsx
//
// The chat assistant's state, for the whole site. The chat itself is shown
// inside the robot guide's panel (PageGuide -> ChatPanel); this provider sits
// above the routes in App.jsx because the robot is rebuilt on every page,
// and the conversation - and whether the chat is open - must survive that.
// Asking to fill in the booking form moves the visitor to /booking, and the
// chat stays open there with everything said so far.
//
// HOW A MESSAGE TRAVELS
//   1. The visitor types; the whole conversation goes to our own server
//      (api/assistant.js -> backend/assistant), which adds the OpenAI key and
//      asks OpenAI. The key never reaches the browser.
//   2. The answer is either text (shown) or a request to use a tool. Tools
//      run here, in the browser (tools.js): the calculator, filling in the
//      booking form, opening a page. Their result goes back to the server in
//      the next request, and the model writes its answer from it.
//
// THE CONVERSATION (`history`) holds three kinds of item, oldest first:
//   { role: 'user' | 'assistant', content: 'text' }          shown in the chat
//   { type: 'function_call', call_id, name, arguments }       a tool the model used
//   { type: 'function_call_output', call_id, output }         what the tool answered
// Only the first kind is shown. It lives in memory only - not in storage,
// because it may hold names and addresses.
//
// `enabled` is false until the server says a key is set; the robot shows no
// chat until then.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { askAssistant, assistantEnabled } from '../../api/assistant';
import { API_ERRORS } from '../../api/client';
import { useLanguage } from '../../i18n/useLanguage';
import { ChatContext, MAX_LENGTH } from './chatContext';
import { runTool } from './tools';

// The server refuses more than 30; older messages are dropped before that.
const KEEP_LAST = 24;
// A question that needs a tool takes two calls (tool, then answer). More
// than this in a row means something is looping: stop there.
const MAX_ROUNDS = 4;

/**
 * The last part of the conversation, starting at a message from the visitor
 * so a tool's result is never sent without the call it answers.
 */
function recent(history) {
  const tail = history.slice(-KEEP_LAST);
  const start = tail.findIndex((item) => item.role === 'user');
  return start === -1 ? tail : tail.slice(start);
}

export default function ChatProvider({ children }) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [enabled, setEnabled] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  // Translation key of the last failure, shown under the messages.
  const [errorKey, setErrorKey] = useState(null);

  // The page as it is now, for tools that run after an `await`.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  // The conversation as it is now, so send() always builds on the latest.
  const historyRef = useRef(history);
  const busyRef = useRef(false);

  // Ask once whether the chat is on. Any failure just leaves it off.
  useEffect(() => {
    let cancelled = false;
    assistantEnabled().then(
      (on) => !cancelled && setEnabled(on),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    async (text) => {
      const content = text.trim().slice(0, MAX_LENGTH);
      if (!content || busyRef.current) return;

      let conversation = [...historyRef.current, { role: 'user', content }];
      const update = (next) => {
        historyRef.current = next;
        setHistory(next);
      };
      update(conversation);
      setErrorKey(null);
      busyRef.current = true;
      setBusy(true);

      try {
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
          const answer = await askAssistant({
            messages: recent(conversation),
            language,
            page: pathnameRef.current,
          });
          const additions = [];
          if (answer.reply) additions.push({ role: 'assistant', content: answer.reply });
          for (const call of answer.tool_calls ?? []) {
            additions.push({ type: 'function_call', ...call });
            additions.push({
              type: 'function_call_output',
              call_id: call.call_id,
              output: runTool(call.name, call.arguments, { navigate, pathname: pathnameRef.current }),
            });
          }
          conversation = [...conversation, ...additions];
          update(conversation);
          // No tools used: that was the answer.
          if (!answer.tool_calls?.length) break;
        }
      } catch (error) {
        setErrorKey(error?.code === API_ERRORS.RATE_LIMITED ? 'chat.errors.tooMany' : 'chat.errors.unavailable');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [language, navigate],
  );

  const value = useMemo(
    () => ({ enabled, history, busy, errorKey, chatOpen, setChatOpen, send }),
    [enabled, history, busy, errorKey, chatOpen, send],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
