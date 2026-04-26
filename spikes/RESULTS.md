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

## Spike 2 — TBD

## Spike 3 — TBD

## Spike 4 — TBD

## Spike 5 — TBD

## Spike 6 — TBD

## Spike 7 — TBD

## Spike 8 — TBD
