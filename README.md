# portman.ca

Static personal site on Vercel. No build step — `index.html`, `about/`, `writing/`
and `assets/` are served as they are. `middleware.js` gates `/admin` behind HTTP
Basic auth (`ADMIN_USER` / `ADMIN_PASS`).

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
