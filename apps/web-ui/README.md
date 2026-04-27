# @x-scraper/web-ui

Phase 0: a single-route review surface for L1 ideas drafted by the
synthesizer. No graph viz yet, no agent chat — just confirm/reject.

## Run

```
pnpm install
pnpm --filter @x-scraper/web-ui dev
```

Open http://localhost:3737/ideas. The vault path defaults to
`~/x-scraper-vault`; override with `XSCRAPER_VAULT`.

## What's here

- `/ideas` — list draft ideas (filter by status: draft / confirmed / rejected).
- `/ideas/<id>` — full idea body with confirm / reject actions.

Server actions read and write the vault directly via `@x-scraper/vault`
— sub-millisecond per call, no REST round-trip.

## What's deferred (per `docs/web-ui/ROADMAP.md`)

- Sigma.js graph viz of Concepts × Claims × Ideas.
- Claude Agent SDK chat surface.
- Source browser, search, claim review.

This scaffold is Phase 0; subsequent phases add the routes above.
