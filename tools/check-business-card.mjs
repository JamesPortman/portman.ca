// Guards the addresses printed on James's business cards. They cannot be
// reprinted, so these URLs must keep working, forever, exactly as they do now:
//
//   portman.ca/#apps     the home page, opened on the Claude Apps tab
//   portman.ca/products  redirects to https://www.portman.ca/#apps, in any
//                        capitalisation (a card may read Portman.ca/Products;
//                        the domain is case-blind, the path is not)
//
// If this fails, fix the site, never this file. Renaming the tab, its hash or
// the redirect breaks every card already handed out.
//
//   node tools/check-business-card.mjs          the repo (index.html, vercel.json)
//   node tools/check-business-card.mjs --live   the live site
//
// The tab is chosen by a script in index.html reading location.hash, so a test
// that only looks for `href="#apps"` would pass while the page opened on the
// wrong tab. This runs the page's own scripts in jsdom instead.

// jsdom is imported only after every network request below: loading it changes
// Node's built-in fetch, after which the live site answered with a different
// 7.5 KB page and redirects came back without a Location header.
import { normalizeRoutes, getTransformedRoutes } from '@vercel/routing-utils';
import { readFileSync } from 'node:fs';

const LIVE = process.argv.includes('--live');
const APPS_URL = 'https://www.portman.ca/#apps';

let fails = 0;
function check(ok, label, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `   (${detail})` : ''}`);
}

// Live: follow the redirect chain by hand, before jsdom loads (see the import
// note above). The card prints the bare domain, which first goes to www.
const liveChains = {};
if (LIVE) {
  for (const start of ['https://portman.ca/products', 'https://portman.ca/Products']) {
    let url = start;
    const hops = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, { redirect: 'manual' });
      const loc = res.headers.get('location');
      hops.push(`${res.status} ${url}`);
      if (res.status < 300 || res.status >= 400 || !loc) break;
      url = new URL(loc, url).href;
    }
    liveChains[start] = { end: url, hops };
  }
}

// 1. /#apps opens the Claude Apps tab.
async function homeHtml() {
  if (!LIVE) return readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const res = await fetch('https://www.portman.ca/', { redirect: 'follow' });
  check(res.ok, 'live home page answers', `HTTP ${res.status}`);
  return res.text();
}

const html = await homeHtml();
const { JSDOM, VirtualConsole } = await import('jsdom');
const vc = new VirtualConsole(); // the page's other scripts (analytics, consent) may complain; not our concern
const dom = new JSDOM(html, {
  url: APPS_URL,
  runScripts: 'dangerously', // inline scripts only: jsdom loads no external resources by default
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLElement.prototype.scrollIntoView = () => {}; // not implemented by jsdom
  },
});
const doc = dom.window.document;

const tab = doc.querySelector('nav a[href="#apps"]');
check(!!tab, 'nav has a link to #apps');
check(tab?.textContent.trim() === 'Claude Apps', '#apps link is labelled "Claude Apps"', `got "${tab?.textContent.trim()}"`);
check(doc.body.getAttribute('data-cat') === 'apps', '#apps selects the apps category', `body data-cat="${doc.body.getAttribute('data-cat')}"`);
check(tab?.getAttribute('aria-current') === 'true', 'Claude Apps tab is marked current');

const projects = [...doc.querySelectorAll('.proj')];
const shown = projects.filter((p) => !p.hidden);
check(shown.length > 0, 'at least one app is shown', `${shown.length} shown`);
check(
  shown.every((p) => ` ${p.getAttribute('data-cats') || ''} `.includes(' apps ')),
  'only apps are shown',
);
check(projects.some((p) => p.hidden), 'other categories are hidden');
dom.window.close();

// 2. /products redirects to https://www.portman.ca/#apps.
if (!LIVE) {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  delete cfg.$schema;
  const { routes } = getTransformedRoutes(cfg);
  const { routes: norm } = normalizeRoutes(routes);
  for (const p of ['/products', '/products/', '/Products', '/Products/', '/PRODUCTS']) {
    const hit = norm.find((r) => !r.continue && r.src && new RegExp(r.src).test(p));
    check(hit?.headers?.Location === APPS_URL, `${p} redirects to ${APPS_URL}`, `got ${hit?.headers?.Location ?? 'no redirect'}`);
  }
  // The home page itself must stay a static file: no route may capture "/".
  check(!norm.some((r) => !r.continue && r.src && new RegExp(r.src).test('/')), '/ is served from index.html, not rerouted');
}

for (const [start, { end, hops }] of Object.entries(liveChains)) {
  check(end === APPS_URL, `${start.replace('https://', '')} ends at ${APPS_URL}`, hops.concat(end).join(' -> '));
}

console.log(fails === 0 ? '\nBusiness-card URLs work.' : `\n${fails} FAILING — the URLs on the business cards are broken`);
process.exit(fails ? 1 : 0);
