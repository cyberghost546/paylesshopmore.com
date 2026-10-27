// src/components/ChatAssistant/chatContext.js
//
// The chat's shared state (see ChatProvider.jsx). Kept apart from the
// provider because a file exporting a component may only export components
// (React Fast Refresh).
//
// The default is "chat off": anything rendered without the provider - the
// robot guide in its own tests - simply shows no chat.

import { createContext } from 'react';

// The longest message the visitor can send (the server allows the same).
export const MAX_LENGTH = 2000;

export const ChatContext = createContext({
  enabled: false,
  history: [],
  busy: false,
  errorKey: null,
  chatOpen: false,
  setChatOpen: () => {},
  send: () => {},
});
