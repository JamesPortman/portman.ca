#!/usr/bin/env node
// Rebuild sitemap.xml from what is actually in the repo.
//
//   node tools/build-sitemap.mjs          # rewrite sitemap.xml
//   node tools/build-sitemap.mjs --check  # report drift, change nothing
//
// Two kinds of URL live in the sitemap and they date differently:
//
//   * A page in this repo (index.html, about/, writing/…) is dated by the last
//     commit that touched its file. Hand-maintained <lastmod> went stale the
//     moment a page was edited without anyone remembering to bump it — every
//     entry read 2026-08-01 while the homepage had changed that morning.
//   * A game served from this domain (/terra-incognita/, /no-exit/ …) is a
//     rewrite in vercel.json to another deployment. There is no local file, so
//     it is dated by the last commit to vercel.json — the last time the route
//     itself changed. The app behind it moves on its own; we cannot see that
//     from here, and claiming a date we did not observe would be worse than a
//     conservative one.
//
// Run it after adding a page or changing a route.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.portman.ca';
const OUT = join(ROOT, 'sitemap.xml');
const CHECK_ONLY = process.argv.includes('--check');

// Pages in this repo: [url path, file that dates it, priority].
const PAGES = [
  ['/', 'index.html', '1.0'],
  ['/about/', 'about/index.html', '0.8'],
  ['/writing/', 'writing/index.html', '0.8'],
  ['/writing/dont-subscribe-build-it/', 'writing/dont-subscribe-build-it/index.html', '0.7'],
];

// Every path rewritten to a game, read from vercel.json so the two cannot drift.
// "/worldcup/(.*)" and "/worldcup" both describe one destination: /worldcup.
const routes = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).rewrites ?? [];
const GAMES = [...new Set(
  routes
    .map((r) => r.source.replace(/\/?\(\.\*\)$/, ''))
    .filter((p) => p && !p.startsWith('/writing')),
)].map((p) => (p === '/worldcup' ? p : `${p}/`));

const lastCommit = (file) => {
  const date = execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', file],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  // Empty means the file is on disk but has never been committed — a page added
  // and not yet checked in. Emitting an empty <lastmod> would be a sitemap that
  // validates and tells search engines nothing, so stop and name the cause.
  // (A shallow clone does not land here: it reports the tip commit for every
  // file, which is wrong but not blank. See the workflow's fetch-depth note.)
  if (!date) throw new Error(`${file} has no commit yet — commit it before building the sitemap`);
  return date;
};

const urls = [];
for (const [path, file, priority] of PAGES) {
  if (!existsSync(join(ROOT, file))) throw new Error(`${file} is in the sitemap but not on disk`);
  urls.push({ path, lastmod: lastCommit(file), priority });
}
for (const path of GAMES) {
  urls.push({ path, lastmod: lastCommit('vercel.json'), priority: '0.6' });
}

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(({ path, lastmod, priority }) => [
    '  <url>',
    `    <loc>${SITE}${path}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n')),
  '</urlset>',
  '',
].join('\n');

const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';

if (CHECK_ONLY) {
  console.log(`${urls.length} urls · sitemap.xml ${xml === current ? 'current' : 'STALE'}`);
  process.exit(xml === current ? 0 : 1);
}

writeFileSync(OUT, xml);
console.log(`${urls.length} urls · sitemap.xml ${xml === current ? 'unchanged' : 'updated'}`);
for (const u of urls) console.log(`  ${u.lastmod}  ${u.path}`);
