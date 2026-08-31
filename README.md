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
| `/beyond-doubt/` | **not deployed yet — see below** |

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

### Beyond Doubt is wired but not live

The rewrite points at `beyond-doubt-is-not-yet-deployed.invalid`, a reserved TLD
(RFC 2606) that can never resolve to anyone's site. Deploying the game means:

1. Create the Vercel project from `JamesPortman/beyond-doubt` (`engine/vercel.json`
   is its config) and give it Postgres, `RESEND_API_KEY` and the rest of the env
   named in the repo's production checklist.
2. Replace that placeholder host in `vercel.json` with the real deployment URL.
3. Set the app's `ALLOWED_ORIGINS` to `https://www.portman.ca` — behind this proxy
   the browser's origin is this domain, not the game's own. A mismatch fails
   silently and looks like the API is down.

Until then `/beyond-doubt/` returns a 502 and the homepage card links into it.
