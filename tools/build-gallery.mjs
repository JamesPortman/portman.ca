#!/usr/bin/env node
// Rebuild the georgianartist.com thumbnail grid on the Paintings view.
//
//   node tools/build-gallery.mjs          # rebuild from the live site
//   node tools/build-gallery.mjs --check  # report drift, change nothing
//
// Reads the public site — no database, no credentials. The homepage gives the
// paintings in gallery order, /photographs gives the photographs; each product
// page supplies its title and full-size image. Thumbnails are written to
// assets/gallery/<id>.jpg and the <div class="tiles"> block in index.html is
// rewritten in place. Stale thumbnails are deleted.
//
// Run it after adding, delisting, or reordering work in the gallery admin.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.georgianartist.com';
const THUMB_DIR = join(ROOT, 'assets', 'gallery');
const INDEX = join(ROOT, 'index.html');
const THUMB_PX = 320;      // displayed at ~100px; 320 covers retina and wide layouts
const JPEG_QUALITY = 74;
const CHECK_ONLY = process.argv.includes('--check');

// Titles shown on portman.ca where they should differ from the gallery's own.
const TITLE_OVERRIDES = {
  'scenic-caves': 'Scenic Caves', // gallery title carries "(2 panels)"
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

async function text(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'portman.ca gallery build' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

// Ordered, de-duplicated ids as they appear in a listing page.
function idsFrom(html, prefix) {
  const ids = [];
  for (const m of html.matchAll(new RegExp(`href="${prefix}([a-z0-9-]+)"`, 'g'))) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

async function work(id, kind) {
  const path = `${kind === 'photograph' ? '/photographs/' : '/products/'}${id}`;
  const html = await text(SITE + path);
  const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1]
    ?.replace(/\s*\|\s*Georgian Bay Artists\s*$/, '').trim();
  const image = html.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  if (!title || !image) throw new Error(`no og:title/og:image on ${path}`);
  return { id, kind, path, title: TITLE_OVERRIDES[id] ?? title, image };
}

function makeThumb({ id, image }) {
  const src = join(tmpdir(), `gallery-src-${id}`);
  execFileSync('curl', ['-sfL', '-o', src, image]);
  execFileSync('sips', ['-Z', String(THUMB_PX), '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(JPEG_QUALITY), src, '--out', join(THUMB_DIR, `${id}.jpg`)],
    { stdio: 'ignore' });
  rmSync(src, { force: true });
}

// The caption names each work, so the image itself is decorative (alt="").
const tile = (w) =>
  `            <a href="${SITE}${w.path}" target="_blank" rel="noopener" title="${esc(w.title)}">` +
  `<img src="assets/gallery/${w.id}.jpg" alt="" loading="lazy" /><span>${esc(w.title)}</span></a>`;

const [home, photos] = await Promise.all([text(SITE + '/'), text(SITE + '/photographs')]);
const wanted = [
  ...idsFrom(home, '/products/').map((id) => ['painting', id]),
  ...idsFrom(photos, '/photographs/').map((id) => ['photograph', id]),
];
if (!wanted.length) throw new Error('no works found — did the listing markup change?');

const works = [];
for (const [kind, id] of wanted) works.push(await work(id, kind));

const existing = readdirSync(THUMB_DIR).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4));
const added = works.filter((w) => !existing.includes(w.id)).map((w) => w.id);
const removed = existing.filter((id) => !works.some((w) => w.id === id));

let html = readFileSync(INDEX, 'utf8');
const block = html.match(/(<div class="tiles">\n)[\s\S]*?(\n {10}<\/div>)/);
if (!block) throw new Error('tiles block not found in index.html');
const next = block[1] + works.map(tile).join('\n') + block[2];
const changed = next !== block[0];

if (CHECK_ONLY) {
  console.log(`${works.length} works live · ${added.length} new · ${removed.length} delisted · markup ${changed ? 'STALE' : 'current'}`);
  process.exit(changed || added.length || removed.length ? 1 : 0);
}

mkdirSync(THUMB_DIR, { recursive: true });
for (const w of works) makeThumb(w);
for (const id of removed) rmSync(join(THUMB_DIR, `${id}.jpg`), { force: true });
writeFileSync(INDEX, html.replace(block[0], next));

console.log(`${works.length} works · ${added.length} added · ${removed.length} removed · index.html ${changed ? 'updated' : 'unchanged'}`);
if (added.length) console.log('  added:   ' + added.join(', '));
if (removed.length) console.log('  removed: ' + removed.join(', '));
