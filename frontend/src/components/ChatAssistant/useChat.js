// src/components/ChatAssistant/useChat.js

import { useContext } from 'react';
import { ChatContext } from './chatContext';

/** The chat's state and send(), from ChatProvider. */
export function useChat() {
  return useContext(ChatContext);
}
