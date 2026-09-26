// Checks vercel.json's routing with the same compiler Vercel uses, so a routing
// mistake fails here rather than in production.
//
// It exists because one did. `/no-exit/:path*` looks like it covers `/no-exit/`,
// and does not: @vercel/routing-utils compiles sources with `strict: true`, which
// drops path-to-regexp's optional trailing slash. The bare-path redirect then sent
// every visitor to `/no-exit/` — the one shape the rewrite could not match — and the
// three games 404'd. `(.*)` matches the empty rest, so it covers both.
//
//   npm test
//
// Add a case whenever a route is added. FALLTHROUGH means no route matched, which
// is correct for anything served as a static file: Vercel checks the filesystem
// before rewrites.

import { normalizeRoutes, getTransformedRoutes } from '@vercel/routing-utils';
import { readFileSync } from 'node:fs';

const cfg = JSON.parse(readFileSync(process.argv[2] ?? new URL('../vercel.json', import.meta.url), 'utf8'));
delete cfg.$schema;
const { routes, error } = getTransformedRoutes(cfg);
if (error) { console.error('CONFIG ERROR:', error.message); process.exit(1); }
const { routes: norm, error: nerr } = normalizeRoutes(routes);
if (nerr) { console.error('NORMALIZE ERROR:', nerr.message); process.exit(1); }

// Paths the routing must handle, and what we expect.
const cases = [
  ['/terra-incognita',            '308 -> /terra-incognita/'],
  ['/terra-incognita/',           'https://terra-incognita-amber.vercel.app/'],
  ['/terra-incognita/api/rooms',  'https://terra-incognita-amber.vercel.app/api/rooms'],
  ['/terra-incognita/version.txt','https://terra-incognita-amber.vercel.app/version.txt'],
  ['/terra-incognita/architecture','https://terra-incognita-amber.vercel.app/architecture'],
  ['/terra-incognita/og.jpg',     'https://terra-incognita-amber.vercel.app/og.jpg'],
  ['/no-exit',                    '308 -> /no-exit/'],
  ['/no-exit/',                   'https://escape-room-six-gamma.vercel.app/'],
  ['/no-exit/css/style.css',      'https://escape-room-six-gamma.vercel.app/css/style.css'],
  ['/no-exit/backgrounds/x.svg',  'https://escape-room-six-gamma.vercel.app/backgrounds/x.svg'],
  ['/no-exit/api/config',         'https://escape-room-six-gamma.vercel.app/api/config'],
  ['/beyond-doubt',               '308 -> /beyond-doubt/'],
  ['/beyond-doubt/',              'https://beyonddoubt.vercel.app/'],
  ['/beyond-doubt/how.html',      'https://beyonddoubt.vercel.app/how.html'],
  ['/beyond-doubt/api/auth/request','https://beyonddoubt.vercel.app/api/auth/request'],
  // The pool is a Next app built with basePath: '/worldcup', so unlike the games the
  // prefix is NOT stripped — the upstream expects it. It also needs no trailing-slash
  // redirect: Next routes its own paths and its assets are absolute, not relative.
  ['/worldcup',                   'https://worldcup-pool-ebon.vercel.app/worldcup'],
  ['/worldcup/how-it-works',      'https://worldcup-pool-ebon.vercel.app/worldcup/how-it-works'],
  ['/worldcup/api/pools',         'https://worldcup-pool-ebon.vercel.app/worldcup/api/pools'],
  ['/worldcup/_next/static/x.js', 'https://worldcup-pool-ebon.vercel.app/worldcup/_next/static/x.js'],
  ['/worldcup/pools/ABC123',      'https://worldcup-pool-ebon.vercel.app/worldcup/pools/ABC123'],
  ['/worldcuppers',               'FALLTHROUGH'],

  // pre-existing behaviour must survive
  ['/writing/terra-incognita',    '308 -> /writing/dont-subscribe-build-it'],
  ['/writing/terra-incognita/',   '308 -> /writing/dont-subscribe-build-it/'],
  // must fall through to the filesystem (no route match = served as a static file)
  ['/',                           'FALLTHROUGH'],
  ['/about/',                     'FALLTHROUGH'],
  ['/assets/site.css',            'FALLTHROUGH'],
  ['/writing/dont-subscribe-build-it/', 'FALLTHROUGH'],
  ['/admin',                      'FALLTHROUGH'],
  // near-misses must NOT be captured by a prefix
  ['/no-exitful',                 'FALLTHROUGH'],
  ['/terra-incognita-notes',      'FALLTHROUGH'],
];

// Header rules compile to `continue: true` routes: they decorate a response and
// fall through, so they never decide where a path lands. Keep them apart.
const headerRoutes = norm.filter((r) => r.continue && r.headers);
const landing = norm.filter((r) => !r.continue);

let fails = 0;
for (const [p, want] of cases) {
  const hit = landing.find((r) => r.src && new RegExp(r.src).test(p));
  let got;
  if (!hit) got = 'FALLTHROUGH';
  else if (hit.headers?.Location) {
    const m = new RegExp(hit.src).exec(p);
    got = '308 -> ' + hit.headers.Location.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
  } else {
    const m = new RegExp(hit.src).exec(p);
    got = hit.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
  }
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.padEnd(38)} ${got}${ok ? '' : `   (expected ${want})`}`);
}
// Security headers apply to this site's own pages, and deliberately not to the
// proxied apps: each app sends its own (some stricter — DENY, no-referrer), and
// the app, not this repo, knows what it needs to frame or share.
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const headerCases = [
  ['/', true],
  ['/about/', true],
  ['/admin', true],
  ['/assets/site.css', true],
  ['/writing/dont-subscribe-build-it/', true],
  ['/worldcuppers', true],
  ['/no-exitful', true],
  ['/terra-incognita-notes', true],
  ['/terra-incognita/', false],
  ['/terra-incognita/api/rooms', false],
  ['/no-exit/', false],
  ['/no-exit/css/style.css', false],
  ['/beyond-doubt/', false],
  ['/beyond-doubt/api/auth/request', false],
  ['/worldcup', false],
  ['/worldcup/api/pools', false],
];
console.log('');
for (const [p, want] of headerCases) {
  const got = {};
  for (const r of headerRoutes) if (new RegExp(r.src).test(p)) Object.assign(got, r.headers);
  const ok = want
    ? Object.entries(SECURITY).every(([k, v]) => got[k] === v)
    : Object.keys(SECURITY).every((k) => !(k in got));
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.padEnd(38)} ${want ? 'security headers' : 'no site headers (app sends its own)'}`);
}

console.log(fails === 0 ? '\nAll route cases pass.' : `\n${fails} FAILING`);
process.exit(fails ? 1 : 0);
