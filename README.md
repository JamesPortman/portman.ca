# portman.ca

Built with [Claude Code](https://claude.com/claude-code).

Static personal site on Vercel. No build step — `index.html`, `about/`, `writing/`
and `assets/` are served as they are. `middleware.js` gates `/admin` behind HTTP
Basic auth (`ADMIN_USER` / `ADMIN_PASS`); see [Analytics](#analytics-a-cookie-free-dashboard-at-admin).

## Business-card URLs never change

Two addresses are printed on business cards, which can't be recalled:

| URL | Must |
|---|---|
| `portman.ca/#apps` | open the home page on the **Apps** tab |
| `portman.ca/products` | redirect to `https://www.portman.ca/#apps`, in any capitalisation (`/Products` too) |

The tab is picked by the script at the bottom of `index.html` from
`location.hash`, so renaming the `apps` category, its nav link or its hash
breaks the cards silently: the page still loads, on the wrong tab.
`tools/check-business-card.mjs` runs the page's own script in jsdom and checks
the redirect; it is part of `npm test`, so CI fails on any change that breaks
either. `.github/workflows/business-card.yml` runs it against the live site
daily (`--live`) and opens an issue if a card URL stops working. If it fails,
fix the site, never the check.

## The three games are served from this domain

`vercel.json` proxies three separate Vercel projects in under this domain, so all
three read as part of the site rather than as links out to `*.vercel.app`:

| Path | Upstream project |
|---|---|
| `/terra-incognita/` | `terra-incognita-amber.vercel.app` |
| `/no-exit/` | `escape-room-six-gamma.vercel.app` |
| `/beyond-doubt/` | `beyonddoubt.vercel.app` (project `beyonddoubt`, no hyphen) |

Each app keeps its own repository, its own Vercel project and its own deploy
pipeline. Nothing here rebuilds or vendors them; this is routing only, so a
deploy of any game reaches the domain the moment it goes live upstream.

### Two things that make it work

**The trailing slash is load-bearing.** The apps address their own assets
relatively (`js/api.js`, not `/js/api.js`) so that one build serves both its own
domain and a subpath here. Relative paths only resolve inside the prefix when the
URL ends in a slash, which is why each bare path has a `permanent` redirect from
`/no-exit` to `/no-exit/`. Removing those redirects breaks the apps silently:
the page still loads, its stylesheet and scripts 404.

**All three apps claim `/api`.** That namespace cannot be shared or routed by
path alone, so it is never exposed at this domain's root — each app reaches its
own API through its own prefix, and the apps derive that prefix at runtime from
`location.pathname`. If you add a fourth app, give it a prefix and teach it the
same trick; do not add a root-level `/api` rewrite.

### The rewrite pattern is `(.*)`, not `:path*`

`/no-exit/:path*` reads as "the prefix and anything under it" and is not. Vercel
compiles `source` with `strict: true`, which removes path-to-regexp's optional
trailing slash, so that pattern matches `/no-exit` and `/no-exit/js/api.js` but
**not** `/no-exit/`. Paired with the bare-path redirect above, every visitor was
sent to the one shape the rewrite could not match, and all three games 404'd.

`(.*)` matches the empty remainder, so it covers `/no-exit/` and deeper
trailing-slash paths too. `npm test` compiles this file with Vercel's own
`@vercel/routing-utils` and asserts where each path lands. CI runs it on every push and pull request
(`.github/workflows/routes.yml`); run it locally after touching `vercel.json`,
and add a case for any route you add.

### The prefix has to reach each app before its subpath works

A game only survives being served here once its own build knows the prefix. Each
of the three learned that separately, and until that change is on the branch the
upstream project deploys, its subpath will load the page and then 404 its own
assets and API. Order matters: land the app change first, then this.

`beyonddoubt` is the one to watch, because unlike the other two it does not set
`git.deploymentEnabled: false` — it deploys straight from a push to `main`, with
no Actions workflow in between. So merging its prefix change is the deploy.

No CORS change is needed for any of them. The browser only ever talks to
portman.ca; Vercel proxies to the upstream server-side, so these are same-origin
requests and the apps' `ALLOWED_ORIGINS` / CORS settings never come into play.
They still matter for the games' own `*.vercel.app` URLs, which keep working.

## The World Cup pool is a subpath too, but mounted differently

`/worldcup` proxies the `worldcup-pool` project, like the three games — with one
difference worth knowing before editing `vercel.json`.

The games are built for a domain root and work out their prefix at runtime, so this
site **strips** it: `/no-exit/(.*)` sends `$1` on alone. The pool is a Next app built
with `basePath: '/worldcup'`, so it expects the prefix and this site **keeps** it:
`/worldcup/(.*)` sends `/worldcup/$1`. Drop that and every route 404s upstream.

It needs no trailing-slash redirect either. Next routes its own paths and emits
absolute asset URLs already carrying the base path, so the reason the games need
`/no-exit` → `/no-exit/` does not apply.

If you add another Next app, `basePath` is the cheaper route: it covers routing,
links and `/_next` assets for free. The one thing it does not cover is `fetch()`,
which is why the pool routes API calls through `apiUrl()` in its own `lib/site.ts`.


## Security headers stop at the proxied apps

`vercel.json` adds `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: SAMEORIGIN` and a minimal `Permissions-Policy` to this site's
own pages. Its `source` excludes `/terra-incognita/`, `/no-exit/`,
`/beyond-doubt/` and `/worldcup`: each app sends its own headers (some stricter
than these), and it is the app that knows what it needs. There is no
Content-Security-Policy yet — GA and inline scripts
would all need allowing first. `npm test` asserts which paths get the headers.

`.vercelignore` keeps `tools/`, `.github/` and repo docs out of the deployment;
with no build step, anything uploaded is publicly served.

## Analytics: a cookie-free dashboard at /admin

`/admin` (behind the Basic auth in `middleware.js`) is this site's own
first-party analytics dashboard. It replaced an embedded Looker Studio (GA4)
report; Google Analytics itself still runs on the site behind the consent banner.

- `assets/track.js`, loaded by every public page, sends one pageview per load and
  a few visitor actions: a painting or photograph clicked through to
  georgianartist.com, one of the apps opened, a screenshot opened full size, an
  Apps / Media / Paintings tab, an outbound link (host name only), an email link.
- `api/track.js` stores them in Postgres (`analytics_events`, created on first
  use). It drops bots, unknown pages, `/admin` and `/api` paths, and any action or
  target it doesn't recognise. **No cookies and no raw IPs**: visitors are counted
  by a hash of day + IP + user agent that changes daily. Country and city come
  from Vercel's edge headers. Google Analytics, which does set cookies, still
  waits for the consent banner; the banner says so.
- `api/stats.js` serves the dashboard's numbers. The page fetches it as
  `/admin/stats` (a rewrite in `vercel.json`) so the browser sends the admin
  login with it; `middleware.js` also gates `/api/stats` directly, and the
  handler checks the same credentials again. Shared code is in `api/_lib/`
  (the leading underscore keeps it from being deployed as a function).
- "Don't count this browser" on the dashboard sets a `localStorage` flag
  (`pc_no_track`) that `track.js` checks before sending anything.
- **Database:** `DATABASE_URL` (or `POSTGRES_URL`), set by connecting a Neon
  database to the project in Vercel (Storage → Create Database → Neon). Without
  it, tracking is a silent no-op and the dashboard says it isn't connected.
- `npm test` runs `tools/check-analytics.mjs`, which drives both handlers
  against an in-memory Postgres (PGlite).

## License

The code is MIT — see [`LICENSE`](LICENSE). The paintings, photographs, other
images and the writing are © James Portman, all rights reserved — see [`NOTICE`](NOTICE).
