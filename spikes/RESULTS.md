# Spike Results

One paragraph per spike, written when it passes. Source of truth for what we learned vs. what's documented in `docs/SPIKES.md`.

---

## Spike 1 — X.com auth (PASSED 2026-04-26)

**Pathway proven:** persistent Patchright profile at `spikes/auth/x-profile/`, launched with `channel: 'chrome'` (real Chrome on this Mac). Headless attempt → if redirected to `/i/flow/login`, fall back to headed → user logs in → close window → on subsequent runs, headless reuses the profile cleanly.

**Confirmed:** required cookies (`auth_token`, `ct0`, `twid`) plus bonus (`guest_id`, `personalization_id`, `kdt`) all persist across runs. `screen_name` extracted from sidebar `data-testid="AppTabBar_Profile_Link"` href; `user_id` extracted from `twid` cookie via `u=(\d+)` pattern. Account: `PatOnTheLevel` / `18276723`.

**Deviations from plan:** dropped the v1.1 `verify_credentials.json` API call — modern x.com requires a Bearer token + `x-csrf-token` header, which we'll harvest in spike 2 by intercepting a real GraphQL request. Sidebar DOM read is sufficient for spike 1's "are we authenticated" question.

**Cookie import (Chrome/Arc keychain):** not implemented in v1 of this spike. Persistent profile + one-time headed login is fast enough for the use case; cookie import deferred to v1.5 only if the headed login becomes friction.

**Production code TODO:** the scraper package's auth module needs the same headless-first-then-headed flow, with profile path moved to `~/Documents/x-scraper-vault/.xscraper/auth/x-profile/`, and exposed as `xs auth login`.

---

## Key verification (PASSED 2026-04-26)

Not a numbered spike — a sanity check on `~/.config/x-scraper/.env`. `pnpm spike spikes/verify-keys.ts` exercised every provider with the cheapest possible call. All six keys live: Anthropic Claude (haiku-4-5), Google Gemini (gemini-embedding-001), OpenAI (text-embedding-3-small), Exa, Tavily, Brave Search. Spike 4 will separately confirm `gemini-embedding-2-preview` works.

---

## Spike 2 — Bookmarks pagination (PASSED 2026-04-26)

**Two paths proven, both converge on 60 entries across 3 pages:**

(A) **Passive capture** — opened `/i/bookmarks` headless, attached a `context.on('response')` listener that filtered on URL substring `/Bookmarks`, auto-scrolled `window.scrollTo(0, document.documentElement.scrollHeight)` with mouse-wheel nudges every 2.5s up to 20 iterations or 50 entries. Captured 3 GraphQL pages and extracted 60 tweet entries plus cursor entries.

(B) **Active replay** — captured the first GraphQL request's URL (with `variables` + `features` query params) and full headers. Built a per-page request that mutates the `variables.cursor` field with the previous response's `cursorType: "Bottom"` value. Re-issued via `context.request.get(url, { headers })` (which inherits the persistent context's cookies) — drops HTTP/2 pseudo-headers (`:authority`, `:path`, etc.) before re-issuing. Got 3 pages × ~20 entries each = 60.

**Production path:** active replay is the cheap default. Each page costs one GraphQL call; we don't need to render the bookmarks UI. Passive scrape stays as fallback — only triggered if X starts 401/403'ing the GraphQL endpoint.

**Production code TODO:**
- Discover the GraphQL `queryId` dynamically by parsing `main.<hash>.js` rather than relying on a captured URL — X rotates queryIds on frontend deploys (~weekly per twscrape's experience).
- Add 429 handling: detect `x-rate-limit-remaining` header → backoff with jitter; on persistent 429, switch to passive scrape mode.
- Track `cursor` per source (bookmarks/likes/posts) so incremental syncs stop at the previous run's last-seen cursor.
- Validate response shape with Zod before parsing.

**Fixtures:** `spikes/fixtures/*.json` are gitignored — they contain real bookmark data and the captured auth headers.

## Spike 3 — TBD

## Spike 4 — TBD

## Spike 5 — TBD

## Spike 6 — TBD

## Spike 7 — TBD

## Spike 8 — TBD
