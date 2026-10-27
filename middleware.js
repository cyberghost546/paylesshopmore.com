// middleware.js — Vercel Routing Middleware, run before the rewrites in
// vercel.json.
//
// WHAT IT DOES
// Adds a secret header, X-Origin-Auth, to every request Vercel passes on to
// the Django API on Railway (/api/ and /admin/). Django refuses requests
// without it (backend/config/origin_guard.py), so the API only answers
// requests that came through this site.
//
// WHY
// The Railway address can be called directly. A direct caller can then send
// any X-Vercel-Forwarded-For it likes, and Django uses that header as the
// visitor's address for rate limits and the admin allow-list
// (backend/config/client_ip.py). With this header required, only Vercel can
// reach Django, and only Vercel sets X-Vercel-Forwarded-For.
//
// SETUP
// ORIGIN_SHARED_SECRET must be set in Vercel's project settings (Environment
// Variables) and the same value in Railway's DJANGO_ORIGIN_SECRET. Unset here,
// nothing is added and the site works exactly as before.
//
// Whatever value a visitor sends in X-Origin-Auth is replaced, never passed on.

import { next } from '@vercel/functions';

export const config = {
  matcher: ['/api/:path*', '/admin', '/admin/:path*'],
};

export default function middleware(request) {
  const secret = process.env.ORIGIN_SHARED_SECRET;
  const headers = new Headers(request.headers);

  if (secret) {
    headers.set('x-origin-auth', secret);
  } else {
    headers.delete('x-origin-auth');
  }

  return next({ request: { headers } });
}
