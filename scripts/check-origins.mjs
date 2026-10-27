// Checks that the hostnames this repository hard-codes still agree.
//
//     node scripts/check-origins.mjs
//
// There is no single place that says where the site lives. The public origin
// is written out in the prerenderer's route table, again in the hook that
// sets a page's canonical link, and three more times in index.html's social
// card tags; where /api goes, and what Django is told the site's address
// is, are in .do/app.yaml. Four files, and nothing makes them move together.
//
// The failure they produce is not a build error. The build is green, the site
// loads, and then a form POST is refused as a CSRF failure, or a link shared
// to WhatsApp previews the old domain. Both get reported days later by
// somebody who cannot say what changed. This is cheaper.
//
// No dependencies on purpose: this runs in CI before `npm ci` would have
// installed anything, and reading four files does not need a YAML parser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const problems = [];
const notes = [];

const fail = (file, message) => problems.push({ file, message });

function report() {
  for (const note of notes) console.log(`  ${note}`);

  if (problems.length === 0) {
    console.log('\norigins agree.');
    process.exit(0);
  }

  console.error(`\n${problems.length} problem(s):\n`);
  for (const { file, message } of problems) console.error(`  ${file}: ${message}`);
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The canonical public origin, taken from the route table.
//
// routes.js is the source of truth rather than one opinion among four: the
// sitemap and every prerendered canonical link are generated from it, so if
// it is wrong the wrongness is already published.
// ---------------------------------------------------------------------------

const routes = read('frontend/scripts/routes.js');
const canonical = routes.match(/url:\s*'([^']+)'/)?.[1];

if (!canonical) {
  fail('frontend/scripts/routes.js', 'no SITE.url found - this file defines the canonical origin');
  report();
}

if (canonical.endsWith('/')) {
  fail(
    'frontend/scripts/routes.js',
    `SITE.url has a trailing slash (${canonical}); every consumer joins paths onto it`
  );
}

notes.push(`canonical origin: ${canonical}`);

// ---------------------------------------------------------------------------
// The second copy: usePageMeta's SITE_URL, used for the canonical <link> the
// client-side router writes on navigation. A mismatch here means a prerendered
// page and the same page reached by clicking claim different canonical URLs -
// the version of this bug a search engine notices and a human does not.
// ---------------------------------------------------------------------------

const hook = read('frontend/src/hooks/usePageMeta.js');
const hookUrl = hook.match(/SITE_URL\s*=\s*'([^']+)'/)?.[1];

if (!hookUrl) {
  fail('frontend/src/hooks/usePageMeta.js', 'no SITE_URL found');
} else if (hookUrl !== canonical) {
  fail(
    'frontend/src/hooks/usePageMeta.js',
    `SITE_URL is ${hookUrl}, but routes.js says ${canonical}`
  );
}

// ---------------------------------------------------------------------------
// The social card tags in index.html. These are absolute by necessity - a
// scraper does not resolve relative URLs - so they are copies, and copies of a
// hostname are what this script exists for.
// ---------------------------------------------------------------------------

const html = read('frontend/index.html');

for (const [, property, value] of html.matchAll(
  /<meta\s+(?:property|name)="((?:og|twitter):[a-z:]+)"\s+content="(https?:\/\/[^"]+)"/g
)) {
  if (value !== canonical && !value.startsWith(`${canonical}/`)) {
    fail('frontend/index.html', `${property} points at ${value}, not ${canonical}`);
  }
}

// ---------------------------------------------------------------------------
// .do/app.yaml: whether /api still reaches Django, and whether the SPA
// fallback is still there.
//
// Read as text, not parsed: this runs before anything is installed, and the
// three things checked are single lines.
// ---------------------------------------------------------------------------

const appSpec = read('.do/app.yaml');

// Each Django route needs preserve_path_prefix, or DigitalOcean strips the
// prefix and Django sees /health/ instead of /api/health/ - every API call is
// then a 404 that looks like a frontend bug.
for (const prefix of ['/api', '/admin', '/static']) {
  const route = new RegExp(`- path: ${prefix}\s*\n\s*preserve_path_prefix: true`);
  if (!route.test(appSpec)) {
    fail('.do/app.yaml', `no ${prefix} route with preserve_path_prefix: true on the api service`);
  }
}

if (!/catchall_document:\s*index\.html/.test(appSpec)) {
  fail('.do/app.yaml', 'no catchall_document: index.html - a deep link refreshed in the browser would 404');
}

// Django is told where the site lives by DigitalOcean itself (${APP_URL}).
// A hard-coded address here goes stale the day a domain is attached.
const frontendUrl = appSpec.match(/key:\s*DJANGO_FRONTEND_URL\s*\n\s*value:\s*(\S+)/)?.[1];

if (!frontendUrl) {
  fail('.do/app.yaml', 'no DJANGO_FRONTEND_URL - without it Django refuses the site\'s own POSTs as CSRF failures');
} else if (frontendUrl !== '${APP_URL}' && frontendUrl !== canonical) {
  fail('.do/app.yaml', `DJANGO_FRONTEND_URL is ${frontendUrl}; use \${APP_URL} or ${canonical}`);
}

report();
