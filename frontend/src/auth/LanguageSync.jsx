// src/auth/LanguageSync.jsx
//
// Keeps the signed-in account's `language` in step with the language the site
// is being read in, so the e-mails about a customer's shipments arrive in the
// language they actually use (backend notifications/messages.py).
//
// Renders nothing. When somebody is signed in and the site language differs
// from the one stored on their account, it sends the new one once. A failure
// is ignored: the worst case is one e-mail in the previous language, and the
// next page load tries again.

import { useEffect, useRef } from 'react';
import { saveProfileLanguage } from '../api/profile';
import { useLanguage } from '../i18n/useLanguage';
import { useAuth } from './useAuth';

export default function LanguageSync() {
  const { user } = useAuth();
  const { language } = useLanguage();
  // "<user id>:<language>" last sent, so a re-render does not send it again
  // while the profile in memory still holds the old value.
  const sent = useRef(null);

  useEffect(() => {
    if (!user?.id || !language || user.language === language) return;
    const key = `${user.id}:${language}`;
    if (sent.current === key) return;
    sent.current = key;
    saveProfileLanguage(language).catch(() => {
      sent.current = null;
    });
  }, [user?.id, user?.language, language]);

  return null;
}
