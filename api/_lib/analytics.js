// First-party, cookie-free analytics shared by api/track.js and api/stats.js.
// Files under api/ whose name starts with "_" are not deployed as functions.
//
// Visitors are counted by a daily-rotating hash of (day + IP + user agent);
// the raw IP is never stored and the hash changes every day, so it can't be
// used to follow someone over time. Google Analytics, which does use cookies,
// stays behind the consent banner; this does not need it.

import { neon } from '@neondatabase/serverless';

// One table. Created on first use; there is no migration step on this site.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS analytics_events (
     id BIGSERIAL PRIMARY KEY,
     ts TIMESTAMPTZ NOT NULL DEFAULT now(),
     kind TEXT NOT NULL,
     action TEXT,
     target TEXT,
     path TEXT NOT NULL,
     referrer TEXT,
     country TEXT,
     city TEXT,
     device TEXT,
     browser TEXT,
     visitor TEXT
   )`,
  'CREATE INDEX IF NOT EXISTS analytics_events_ts ON analytics_events (ts)',
];

let db = null;
/** A query function `(text, params) => rows`, or null when no database is configured. */
export function getDb() {
  if (db) return db;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) return null;
  const sql = neon(url);
  db = (text, params = []) => sql.query(text, params);
  return db;
}

/** Tests (tools/check-analytics.mjs) run the handlers against an in-memory Postgres. */
export function setDbForTests(query) { db = query; }

const ready = new WeakSet();
export async function ensureSchema(query) {
  if (ready.has(query)) return;
  for (const s of SCHEMA) await query(s);
  ready.add(query);
}

// Public pages only: lower-case slugs, optional .html, never /admin or /api.
const PATH = /^\/(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+(?:\.html)?)?$/;
export function validPath(p) {
  return typeof p === 'string' && p.length <= 120 && PATH.test(p) &&
    !p.startsWith('/admin') && !p.startsWith('/api');
}

const APPS = new Set(['terra-incognita', 'no-exit', 'beyond-doubt', 'worldcup']);
const SECTIONS = new Set(['apps', 'media', 'paintings']);

// Visitor actions sent by assets/track.js, each with the only target it may carry.
export const ACTIONS = {
  outbound_click: (t) => /^[a-z0-9.-]{1,100}$/.test(t),          // host name only
  painting_click: (t) => /^(products|photographs)\/[a-z0-9-]{1,80}$/.test(t), // georgianartist.com
  app_open: (t) => APPS.has(t),
  screenshot_open: (t) => /^[a-z0-9-]{1,80}\.(jpg|jpeg|png|webp)$/.test(t),
  section_open: (t) => SECTIONS.has(t),
  email_click: (t) => t === '',
};

/** Turn a beacon body into a row to store, or null to drop it. */
export function parseEvent(body) {
  if (!body || typeof body !== 'object') return null;
  if (!validPath(body.path)) return null;
  if (body.kind === 'action') {
    const action = typeof body.action === 'string' ? body.action : '';
    const target = typeof body.target === 'string' ? body.target.toLowerCase() : '';
    const ok = Object.prototype.hasOwnProperty.call(ACTIONS, action) && ACTIONS[action](target);
    if (!ok) return null;
    return { kind: 'action', action, target: target || null, path: body.path, referrer: '' };
  }
  let referrer = '';
  try {
    if (typeof body.referrer === 'string' && body.referrer) referrer = new URL(body.referrer).hostname.slice(0, 253);
  } catch { /* not a URL */ }
  return { kind: 'pageview', action: null, target: null, path: body.path, referrer };
}

// Crawlers, link previews and scripted clients — not people.
export function isBot(ua) {
  const s = (ua || '').toLowerCase();
  if (!s) return true;
  return /bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|facebot|embedly|quora link preview|outbrain|pinterest\/|developers\.google|google-inspectiontool|chrome-lighthouse|headlesschrome|phantomjs|puppeteer|playwright|python-requests|axios|curl|wget|node-fetch|go-http-client|java\/|httpclient|monitoring|uptimerobot|pingdom|gtmetrix|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|amazonbot|applebot|yandex|baiduspider|duckduckbot|whatsapp|telegrambot|discordbot|slackbot|twitterbot|linkedinbot|preview/.test(s);
}

// Coarse buckets only: enough for a dashboard, not a fingerprint.
export function parseUA(ua) {
  const s = (ua || '').toLowerCase();
  let device = 'desktop';
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk|playbook/.test(s)) device = 'tablet';
  else if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|bb10|opera mini|iemobile/.test(s)) device = 'mobile';

  let browser = 'Other';
  if (/edg(a|ios|e)?\//.test(s)) browser = 'Edge';
  else if (/opr\/|opera/.test(s)) browser = 'Opera';
  else if (/samsungbrowser/.test(s)) browser = 'Samsung Internet';
  else if (/firefox|fxios/.test(s)) browser = 'Firefox';
  else if (/chrome|crios|chromium/.test(s)) browser = 'Chrome';
  else if (/safari/.test(s)) browser = 'Safari';
  return { device, browser };
}

export async function visitorHash(ip, ua, now = new Date()) {
  const day = now.toISOString().slice(0, 10); // rotates daily (UTC)
  const data = new TextEncoder().encode(day + '|' + ip + '|' + ua + '|portman-v1');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Vercel's edge geo headers. The city arrives URL-encoded ("S%C3%A3o%20Paulo"). */
export function geo(headers) {
  const country = (headers.get('x-vercel-ip-country') || '').slice(0, 8);
  let city = headers.get('x-vercel-ip-city') || '';
  try { city = decodeURIComponent(city); } catch { /* keep raw */ }
  return { country, city: city.slice(0, 80) };
}

export async function insertEvent(query, row) {
  await ensureSchema(query);
  await query(
    `INSERT INTO analytics_events (kind, action, target, path, referrer, country, city, device, browser, visitor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [row.kind, row.action, row.target, row.path, row.referrer, row.country, row.city, row.device, row.browser, row.visitor],
  );
}

export const RANGES = [7, 30, 90, 0];

/** Everything the dashboard shows, for the last `days` days (0 = all time). */
export async function getStats(query, days, now = new Date()) {
  await ensureSchema(query);
  const span = days * 864e5;
  const since = new Date(days > 0 ? now.getTime() - span : 0);
  const prevSince = new Date(days > 0 ? since.getTime() - span : 0);
  // The chart's 7-day average needs the six days before the range too.
  const trendSince = new Date(days > 0 ? since.getTime() - 6 * 864e5 : 0);
  const PV = "kind = 'pageview'";
  const ACT = "kind = 'action'";
  const n = (rows) => Number(rows[0]?.c ?? 0);
  const num = (rows) => rows.map((r) => ({ ...r, c: Number(r.c) }));

  const [
    views, prevViews, unique, prevUnique, actions, prevActions,
    byDay, topPaths, sections, actionRows, paintings, apps,
    devices, browsers, referrers, countries, recent,
  ] = await Promise.all([
    query(`SELECT COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ${PV}`, [since]),
    query(`SELECT COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ${PV}`, [prevSince, since]),
    query('SELECT COUNT(DISTINCT visitor) AS c FROM analytics_events WHERE ts >= $1', [since]),
    query('SELECT COUNT(DISTINCT visitor) AS c FROM analytics_events WHERE ts >= $1 AND ts < $2', [prevSince, since]),
    query(`SELECT COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ${ACT}`, [since]),
    query(`SELECT COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ts < $2 AND ${ACT}`, [prevSince, since]),
    query(`SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                  COUNT(*) FILTER (WHERE ${PV}) AS views, COUNT(DISTINCT visitor) AS visitors
           FROM analytics_events WHERE ts >= $1 GROUP BY 1 ORDER BY 1`, [trendSince]),
    query(`SELECT path, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ${PV} GROUP BY path ORDER BY c DESC LIMIT 10`, [since]),
    query(`SELECT target AS section, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND action = 'section_open' GROUP BY target ORDER BY c DESC`, [since]),
    query(`SELECT action, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ${ACT} GROUP BY action ORDER BY c DESC`, [since]),
    query(`SELECT target, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND action = 'painting_click' GROUP BY target ORDER BY c DESC LIMIT 10`, [since]),
    query(`SELECT target AS app, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND action = 'app_open' GROUP BY target ORDER BY c DESC`, [since]),
    query(`SELECT device, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ${PV} GROUP BY device ORDER BY c DESC`, [since]),
    query(`SELECT COALESCE(browser, 'Unknown') AS browser, COUNT(*) AS c FROM analytics_events WHERE ts >= $1 AND ${PV} GROUP BY 1 ORDER BY c DESC`, [since]),
    query(`SELECT CASE WHEN referrer IS NULL OR referrer = '' THEN 'Direct / none' ELSE referrer END AS ref, COUNT(*) AS c
           FROM analytics_events WHERE ts >= $1 AND ${PV} GROUP BY 1 ORDER BY c DESC LIMIT 10`, [since]),
    query(`SELECT CASE WHEN country IS NULL OR country = '' THEN 'Unknown' ELSE country END AS country, COUNT(*) AS c
           FROM analytics_events WHERE ts >= $1 AND ${PV} GROUP BY 1 ORDER BY c DESC LIMIT 10`, [since]),
    query(`SELECT (EXTRACT(EPOCH FROM ts) * 1000)::bigint AS ts, kind, action, target, path, device, browser, city, country
           FROM analytics_events WHERE ts >= $1 ORDER BY ts DESC, id DESC LIMIT 50`, [since]),
  ]);

  return {
    days,
    now: now.getTime(),
    views: n(views),
    unique: n(unique),
    actions: n(actions),
    // No earlier period to compare "all time" with.
    prev: days > 0 ? { views: n(prevViews), unique: n(prevUnique), actions: n(prevActions) } : null,
    byDay: byDay.map((r) => ({ day: r.day, views: Number(r.views), visitors: Number(r.visitors) })),
    topPaths: num(topPaths),
    sections: num(sections),
    actionBreakdown: num(actionRows),
    paintings: num(paintings),
    apps: num(apps),
    devices: num(devices),
    browsers: num(browsers),
    topReferrers: num(referrers),
    topCountries: num(countries),
    recent: recent.map((r) => ({ ...r, ts: Number(r.ts) })),
  };
}

// Constant-time comparison: hash both sides, then XOR every byte.
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, dbuf] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(da), y = new Uint8Array(dbuf);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * The same HTTP Basic check middleware.js applies to /admin, repeated here so
 * the stats endpoint stays closed even if a routing change ever bypassed the
 * middleware. Fails closed when the credentials aren't configured.
 */
export async function isAdmin(headers) {
  const user = process.env.ADMIN_USER, pass = process.env.ADMIN_PASS;
  if (!user || !pass) return false;
  const h = headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const i = decoded.indexOf(':');
  if (i === -1) return false;
  const [u, p] = await Promise.all([safeEqual(decoded.slice(0, i), user), safeEqual(decoded.slice(i + 1), pass)]);
  return u && p;
}
