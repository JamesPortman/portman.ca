# CLAUDE.md — portman.ca

## Business-card URLs are frozen

`portman.ca/#apps` and `portman.ca/products` are printed on James's business
cards. They must keep working exactly as they do now, permanently:

- `/#apps` opens the home page on the **Apps** tab. Never rename the
  `apps` category, its `#apps` nav link, or the hash the tab script in
  `index.html` reads. Reordering, adding or removing apps is fine.
- `/products` (any capitalisation, with or without a trailing slash) redirects
  to `https://www.portman.ca/#apps`. Never remove or retarget that redirect in
  `vercel.json`, and never put a page at `/products`.

`npm test` runs `tools/check-business-card.mjs`, and
`.github/workflows/business-card.yml` checks the live site daily. If either
fails, fix the site. Do not edit the check to make it pass. See the README's
"Business-card URLs never change".
