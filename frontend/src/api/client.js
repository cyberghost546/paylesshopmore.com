// src/api/client.js
//
// One place that knows how to talk to the Django API: base URL, cookies and
// the CSRF header. Everything else in src/api builds on this.

// Same origin by default, and that is the arrangement this project is built
// for: in development the Vite proxy below forwards /api to Django, and in
// production the static host rewrites /api to the API. Either way the browser
// sees one origin, so the session cookie is first-party — which is what keeps
// it working in Safari and Firefox, both of which now discard or partition a
// third-party cookie regardless of SameSite.
//
// VITE_API_BASE_URL is the escape hatch for a deployment that cannot put a
// rewrite in front, and it is a genuine downgrade rather than an equal
// alternative: a cross-origin API needs DJANGO_CROSS_SITE_COOKIES on the
// server, and customers on Safari will not stay signed in. Set it to the
// API origin including /api, e.g. https://api.example.com/api

function stripTrailingSlash(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim();

// A trailing slash here and a leading slash on every path would produce
// //auth/login/, which some proxies normalise and some answer 404 for.
const BASE_URL = configuredBase
  ? stripTrailingSlash(configuredBase)
  : '/api';

/**
 * The full address of an API path, for the few places the browser fetches it
 * itself rather than through request() - an <img> showing a damage photo.
 * Same origin, so the session cookie goes with it.
 *
 * @param {string} path e.g. '/staff/warehouse/damage/4/photos/9/'
 */
export function apiUrl(path) {
  return `${BASE_URL}${path}`;
}

export const API_ERRORS = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  VALIDATION: 'VALIDATION',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAVAILABLE: 'UNAVAILABLE',
  // The "Confirm it's you" box was closed without confirming (see
  // setReauthHandler below).
  REAUTH_CANCELLED: 'REAUTH_CANCELLED',
  // Still used by the quote form, which has no endpoint yet.
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
};

export class ApiError extends Error {
  /**
   * @param {string} code one of API_ERRORS
   * @param {object} [fields] per-field messages from the server, if any
   * @param {number} [status] the HTTP status, when there was a response. Lets
   *   a caller tell apart two failures that share a code — a 404 from the
   *   tracking lookup means "no such shipment", not "the site is down".
   */
  constructor(code, fields = null, status = null) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

/**
 * Told when the server refuses a request for who the caller is, rather than
 * for what the request said.
 *
 * The problem this solves is the dashboard's. Whether someone is signed in is
 * decided once, when the app starts, and the server can disagree at any point
 * afterwards: the session expires overnight, another admin takes the staff
 * role away, the account is deactivated. Every request then answers 403 and
 * every page shows "could not connect" with a retry button that will never
 * work, because there is nothing wrong with the connection.
 *
 * So the failure is announced here, where every request already passes
 * through, and the auth context is left to decide what it means — this module
 * knows nothing about React, and importing the context here would be a cycle.
 */
const authFailureHandlers = new Set();

/**
 * @param {(error: ApiError) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onAuthFailure(handler) {
  authFailureHandlers.add(handler);
  return () => authFailureHandlers.delete(handler);
}

function announceAuthFailure(error) {
  for (const handler of authFailureHandlers) {
    // One subscriber throwing must not stop the others being told, and must
    // not turn into the rejection the caller sees for their own request.
    try {
      handler(error);
    } catch {
      // Nothing useful to do with it here.
    }
  }
}

// ---- "Confirm it's you" (re-authentication) --------------------------------
//
// Some admin actions (changing a role, deleting an account, making an API key)
// need the password typed again if it has not been typed in the last few
// minutes (backend accounts/reauth.py). The server then answers 403 with
// code "reauth_required". Instead of every page handling that, request()
// below does it in ONE place:
//
//   1. it asks the registered handler (components/ReauthDialog) to show the
//      "Confirm it's you" box and wait for the person;
//   2. once they have confirmed, it sends the SAME request again, once;
//   3. if they cancel, the request fails with REAUTH_CANCELLED.

let reauthHandler = null;

/**
 * Registers the function that shows the box. It receives { needsCode } and
 * returns a promise: resolved once confirmed, rejected when cancelled.
 */
export function setReauthHandler(handler) {
  reauthHandler = handler;
}

let lastServerContact = Date.now();

/**
 * When the server last answered a request somebody made, as Date.now(). A
 * warehouse code session ends after so long without one (see
 * accounts/middleware.py), so this is the browser's copy of the same clock.
 * Requests marked `background` do not move it, on either side.
 */
export function lastHeardFromServer() {
  return lastServerContact;
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Django will not accept a write without a CSRF token. The token lives in a
 * readable cookie, which the server sets on the first GET; if it is missing
 * (a fresh tab), ask for one before continuing.
 */
async function csrfToken() {
  const existing = readCookie('csrftoken');
  if (existing) return existing;

  await fetch(`${BASE_URL}/auth/csrf/`, { credentials: 'include' });
  return readCookie('csrftoken');
}

/**
 * @param {string} path e.g. '/auth/login/'
 * @param {{ method?: string, body?: object, formData?: FormData,
 *          silentAuthFailure?: boolean, background?: boolean }} [options]
 *   `silentAuthFailure` is for the two calls that must not set off the
 *   announcement above: the profile read that decides whether anybody is
 *   signed in — where a 403 is the ordinary answer for a signed-out visitor —
 *   and the one the auth context makes to check a refusal, which would
 *   otherwise announce its own failure and ask itself to check again.
 *   `background` is for requests the app makes on a timer rather than because
 *   somebody did something: a board refreshing itself, notifications polled.
 *   The server answers them as usual but does not count them as a floor worker
 *   being active, or a device left on a self-refreshing page would never go
 *   idle and would stay signed in as whoever used it last.
 */
export async function request(path, options = {}) {
  const { method = 'GET', body, formData, silentAuthFailure = false, background = false, reauthDone = false } =
    options;
  const headers = {};
  if (background) headers['X-Background-Refresh'] = '1';
  const isWrite = method !== 'GET' && method !== 'HEAD';

  if (isWrite) {
    const token = await csrfToken();
    if (token) headers['X-CSRFToken'] = token;
  }

  // FormData sets its own multipart Content-Type, including the boundary.
  // Setting the header by hand is the classic way file uploads break.
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      // Sends and stores the session cookie.
      credentials: 'include',
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    // fetch only rejects on a network failure, never on an HTTP error status.
    throw new ApiError(API_ERRORS.UNAVAILABLE);
  }

  // An answer to something somebody did is what keeps a floor worker's
  // session going. Noted here so the browser can count the same idle time
  // down without asking - see AuthContext.
  if (!background && response.status < 500) lastServerContact = Date.now();

  if (response.status === 204) return null;

  // An error page or an empty body is not JSON; that is not itself a failure.
  const data = await response.json().catch(() => null);

  if (response.ok) return data;

  const { status } = response;

  if (status === 401) throw new ApiError(API_ERRORS.INVALID_CREDENTIALS, null, status);

  if (status === 403 && data?.code === 'reauth_required' && reauthHandler && !reauthDone) {
    // "Confirm it's you": show the box, then try the same request once more.
    try {
      await reauthHandler({ needsCode: Boolean(data.needs_code) });
    } catch {
      throw new ApiError(API_ERRORS.REAUTH_CANCELLED, data, status);
    }
    return request(path, { ...options, reauthDone: true });
  }

  if (status === 403) {
    const refusal = new ApiError(API_ERRORS.UNAUTHENTICATED, data, status);

    // Two different refusals arrive as 403: no session at all, and a session
    // belonging to an account that may not have this. The auth context tells
    // them apart by re-reading the profile; all this has to do is say that
    // the server refused on identity rather than on content.
    if (!silentAuthFailure) announceAuthFailure(refusal);

    throw refusal;
  }
  if (status === 429) throw new ApiError(API_ERRORS.RATE_LIMITED, null, status);

  if (status === 400) {
    // The server says so explicitly. Inferring it from "there is an error on
    // the email field" was wrong: "enter a valid e-mail address" is also an
    // error on that field, and needs the opposite advice.
    if (data?.code === 'email_taken') {
      throw new ApiError(API_ERRORS.EMAIL_TAKEN, data, status);
    }
    throw new ApiError(API_ERRORS.VALIDATION, data, status);
  }

  // The body is carried through rather than dropped. A 409 is the one
  // status that regularly arrives with something worth reading — "an invoice
  // already exists for this shipment", and the id of the one that does — and
  // throwing that away left the pages guessing at a sentence the server had
  // already written. Still UNAVAILABLE as the code: nothing here knows what
  // the refusal was about, only that it was not a validation error.
  throw new ApiError(API_ERRORS.UNAVAILABLE, data, status);
}
