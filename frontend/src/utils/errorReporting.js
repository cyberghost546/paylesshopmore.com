// src/utils/errorReporting.js
//
// READ THIS FIRST
// ---------------
// When the site crashes in a visitor's browser, we want to KNOW about it.
// Before this file, such an error only ever existed in that visitor's browser
// console - nobody at the office would ever hear about it.
//
// This file sends a short report of each error to our own server:
//
//     POST /api/client-errors/   (backend ops/views.py)
//
// The server writes it to the log, and when Sentry is set up (SENTRY_DSN on
// the server) Sentry turns it into an issue and e-mails us. See
// docs/BACKUPS.md, "Error monitoring".
//
// What gets reported, from three places:
//   1. window "error"              - a script error nobody caught
//   2. window "unhandledrejection" - a promise that failed and nobody caught
//   3. reportError(...)            - called by our ErrorBoundary when a page
//                                    fails to draw (components/ErrorBoundary)
//
// What is sent: the error message, the stack (where in the code), the page
// address and where it was caught. NEVER who is signed in, cookies or what
// somebody typed into a form.
//
// Limits, so a page that crashes in a loop cannot flood anything:
//   - at most MAX_REPORTS per page visit,
//   - the same message only once per page visit.
// The server has its own limit per visitor on top (30 an hour).

import { apiUrl } from '../api/client';

const MAX_REPORTS = 10;

// Messages that are not our bug: browser extensions, and the famous
// "ResizeObserver loop" warning that browsers raise as an error.
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i];

let sent = 0;
const seen = new Set();

/**
 * Report one error. Safe to call with anything (an Error, a string, undefined)
 * and never throws - error reporting must not cause a second error.
 *
 * @param {unknown} error
 * @param {string} [source] where it was caught, e.g. 'boundary'
 */
export function reportError(error, source = 'manual') {
  try {
    const message = String(error?.message ?? error ?? '').slice(0, 500);
    if (!message || IGNORED.some((pattern) => pattern.test(message))) return;
    if (seen.has(message) || sent >= MAX_REPORTS) return;
    seen.add(message);
    sent += 1;

    const body = JSON.stringify({
      message,
      stack: String(error?.stack ?? '').slice(0, 4000),
      // The page without the ?query part: a query can hold a search term or
      // a token, and the page itself is enough to find the bug.
      url: `${window.location.origin}${window.location.pathname}`,
      source,
    });

    // keepalive: the report still goes out if the page is being closed.
    // No cookies (credentials: 'omit'): the report is never tied to a person.
    fetch(apiUrl('/client-errors/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {
      // Offline, or the server is down. Nothing sensible to do.
    });
  } catch {
    // Reporting failed. Never let that become a new error.
  }
}

/**
 * Start listening for uncaught errors. Call once, when the app starts
 * (main.jsx). Does nothing during development, where the error overlay and
 * the console already show everything - and the reports would only be noise.
 */
export function installErrorReporting() {
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') return;

  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, 'window');
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'promise');
  });
}

/** For tests only: forget what was sent, so each test starts fresh. */
export function resetErrorReportingForTests() {
  sent = 0;
  seen.clear();
}
