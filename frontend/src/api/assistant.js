// src/api/assistant.js
//
// The chat assistant (backend/assistant). The OpenAI key stays on the server:
// the browser only ever talks to our own /api/assistant/.

import { request } from './client';

/** Whether the chat is switched on (a key is set on the server). */
export async function assistantEnabled() {
  const data = await request('/assistant/', { silentAuthFailure: true });
  return Boolean(data?.enabled);
}

/**
 * Ask for the next turn of the conversation.
 *
 * @param {{ messages: object[], language: string, page: string }} details
 *   messages: the whole conversation so far, oldest first (see
 *   ChatAssistant.jsx for the shapes).
 * @returns {Promise<{ reply: string, tool_calls: { call_id: string, name: string, arguments: string }[] }>}
 */
export function askAssistant({ messages, language, page }) {
  return request('/assistant/', {
    method: 'POST',
    body: { messages, language, page },
    silentAuthFailure: true,
  });
}
