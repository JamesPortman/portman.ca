// Runs api/track.js and api/stats.js against an in-memory Postgres (PGlite),
// so the SQL, the validation and the auth check are exercised before deploy.
//
//   npm test   (runs this after the route checks)

import { PGlite } from '@electric-sql/pglite';
import { setDbForTests } from '../api/_lib/analytics.js';
import { POST as track } from '../api/track.js';
import { GET as stats } from '../api/stats.js';

const pg = new PGlite();
const query = async (text, params = []) => (await pg.query(text, params)).rows;
setDbForTests(query);
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'secret';

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/604.1',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

async function send(body, ua = UA.chrome, ip = '1.2.3.4') {
  const res = await track(new Request('https://www.portman.ca/api/track', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'user-agent': ua, 'x-forwarded-for': ip, 'x-vercel-ip-country': 'CA', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' },
  }));
  return res.status;
}
const count = async () => Number((await query('SELECT COUNT(*) AS c FROM analytics_events'))[0].c);

let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };

// Valid traffic
check('beacon answers 204', (await send({ kind: 'pageview', path: '/', referrer: 'https://www.google.com/search?q=x' })) === 204);
await send({ kind: 'pageview', path: '/about/' }, UA.iphone, '5.6.7.8');
await send({ kind: 'pageview', path: '/writing/dont-subscribe-build-it/' }, UA.ipad, '9.9.9.9');
let n = await count();
check('3 pageviews recorded', n === 3);

for (const [action, target] of [
  ['painting_click', 'products/blue-mountain-sunset-painting'],
  ['painting_click', 'photographs/the-grotto'],
  ['painting_click', 'products/blue-mountain-sunset-painting'],
  ['app_open', 'no-exit'],
  ['screenshot_open', 'baylight-site-full.jpg'],
  ['section_open', 'paintings'],
  ['outbound_click', 'github.com'],
  ['email_click', ''],
]) await send({ kind: 'action', action, target, path: '/' });
check('8 actions recorded', (await count()) === n + 8);
n = await count();

// Everything below must be dropped.
const dropped = [
  [{ kind: 'pageview', path: '/' }, UA.bot],
  [{ kind: 'pageview', path: '/' }, ''],
  [{ kind: 'pageview', path: '/admin/' }],
  [{ kind: 'pageview', path: '/api/stats' }],
  [{ kind: 'pageview', path: '/<script>' }],
  [{ kind: 'pageview', path: '/' + 'a'.repeat(200) }],
  [{ kind: 'action', action: 'hack', target: '', path: '/' }],
  [{ kind: 'action', action: 'app_open', target: 'evil-app', path: '/' }],
  [{ kind: 'action', action: 'painting_click', target: '../etc/passwd', path: '/' }],
  [{ kind: 'action', action: 'outbound_click', target: 'a b.com', path: '/' }],
  [{ kind: 'action', action: 'email_click', target: 'x', path: '/' }],
  [{ kind: 'action', action: '__proto__', target: '', path: '/' }],
  [{ kind: 'action', action: 'toString', target: '', path: '/' }],
  ['not json'],
  ['{"path":"/","x":"' + 'y'.repeat(3000) + '"}'],
];
for (const [body, ua] of dropped) await send(body, ua ?? UA.chrome);
check('bots, admin/api paths, unknown or malformed actions all dropped', (await count()) === n);

const iphone = (await query("SELECT * FROM analytics_events WHERE path = '/about/'"))[0];
check('mobile + Safari parsed, city decoded', iphone.device === 'mobile' && iphone.browser === 'Safari' && iphone.city === 'São Paulo' && iphone.country === 'CA');
check('tablet detected', (await query("SELECT device FROM analytics_events WHERE path LIKE '/writing/%'"))[0].device === 'tablet');
check('referrer reduced to host', (await query("SELECT referrer FROM analytics_events WHERE referrer <> '' LIMIT 1"))[0]?.referrer === 'www.google.com');
check('no raw IP stored', (await query("SELECT COUNT(*) AS c FROM analytics_events WHERE visitor LIKE '%1.2.3.4%'"))[0].c == 0);

// Older rows for the previous-period comparison.
await query("INSERT INTO analytics_events (ts, kind, path, visitor, device) VALUES (now() - interval '40 days', 'pageview', '/', 'old1', 'desktop'), (now() - interval '45 days', 'pageview', '/', 'old2', 'desktop')");

const auth = (u, p) => ({ authorization: 'Basic ' + btoa(u + ':' + p) });
async function getStats(days, headers = auth('admin', 'secret')) {
  const res = await stats(new Request('https://www.portman.ca/api/stats?days=' + days, { headers }));
  return [res.status, res.status === 200 ? await res.json() : null];
}
check('no credentials → 401', (await getStats(30, {}))[0] === 401);
check('wrong password → 401', (await getStats(30, auth('admin', 'nope')))[0] === 401);

const [status, s] = await getStats(30);
check('stats 200', status === 200);
check('views 3, actions 8', s.views === 3 && s.actions === 8);
check('previous 30 days: 2 views', s.prev.views === 2 && s.prev.actions === 0);
check('most clicked artwork first', s.paintings[0]?.target === 'products/blue-mountain-sunset-painting' && s.paintings[0].c === 2);
check('apps, tabs and action breakdown', s.apps[0]?.app === 'no-exit' && s.sections[0]?.section === 'paintings' && s.actionBreakdown.length === 6);
check('devices include tablet, browsers include Chrome', s.devices.some((d) => d.device === 'tablet') && s.browsers.some((b) => b.browser === 'Chrome'));
check('recent: 11 rows, newest first', s.recent.length === 11 && s.recent[0].ts >= s.recent[10].ts);
check('chart has today', s.byDay.at(-1)?.day === new Date().toISOString().slice(0, 10));

const [, all] = await getStats(0);
check('all time: 5 views, no previous period', all.views === 5 && all.prev === null);
check('unknown range falls back to 30', (await getStats(12345))[1].days === 30);

// Without credentials configured, the endpoint stays closed.
delete process.env.ADMIN_PASS;
check('no ADMIN_PASS configured → 401', (await getStats(30))[0] === 401);

console.log(fails === 0 ? '\nAll analytics checks pass.' : `\n${fails} FAILING`);
process.exit(fails ? 1 : 0);
