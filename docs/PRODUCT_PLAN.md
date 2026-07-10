# Product Plan — Interest Graph (living)

> **Status:** active  
> **Owner:** agent + Pat  
> **Created:** 2026-07-10  
> **Last updated:** 2026-07-10  
> **Current phase:** Phase 4 optional / product maintenance  

> **North star:** Bookmark → named interest → connections → recall

This is the working plan for reshaping x-scraper from a pipeline/catalog into a
**personal interest graph**. Every implementation session should open this file,
pick the next unchecked task, and update status before ending.

Related (do not replace):

| Doc                                           | Role                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| [HANDOFF.md](../HANDOFF.md)                   | Session-to-session ops state                                  |
| [ARCHITECTURE.md](./ARCHITECTURE.md)          | System design (infra truth)                                   |
| [ROADMAP.md](./ROADMAP.md)                    | Original slice roadmap (historical + remaining infra)         |
| [docs/web-ui/ROADMAP.md](./web-ui/ROADMAP.md) | Earlier UI phases (graph viz etc. — subordinate to this plan) |
| [CODING_STANDARDS.md](./CODING_STANDARDS.md)  | Code quality rules                                            |

---

## 1. Product thesis

**One sentence:**  
A personal interest graph that turns every X bookmark into durable memory —
with automatic titles, growing themes, and "this connects to that" — so later-you
can recall and think with it, not just archive it.

### Jobs to be done (must feel magical)

| #   | Job         | Passes when…                                                                                  |
| --- | ----------- | --------------------------------------------------------------------------------------------- |
| J1  | **Capture** | New bookmark appears in minutes with human title + short gist, not a naked URL                |
| J2  | **Connect** | Every new item surfaces 2–5 links to _existing_ ideas/entities/sources with a one-line reason |
| J3  | **Recall**  | "What have I saved about X?" returns cited, ranked answers via UI or MCP                      |

### Explicit non-goals (this plan)

- Multi-user / hosted service
- Shipping a pretty graph canvas before `related()` is useful as lists
- Perfect bi-temporal purity as a user-facing concern
- Expanding content types (likes, posts) before connection quality is good
- Architecture refactors that do not move J1–J3

### Diagnosis (why it currently fails)

1. **Pipeline over habit** — capture/extract/ER/synthesize are strong; daily open-and-learn is weak.
2. **Warehouse UI** — counts, URLs, entity leaderboards ≠ "this knows what I'm into."
3. **Connections buried** — graph structure exists; no first-class "why together" surface.
4. **Ideas = entity monographs** — wiki blurbs, not living research threads / open questions.
5. **Infra tax** — partial syncs, empty topics, uncommitted session-9 surface, heavy deps.
6. **MCP thin** — original "context one tool call away" promise never became the hero path.

---

## 2. Baseline

### Pre Phase 0 (2026-07-10 morning)

| Signal           | Baseline                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| Branch           | `main`, ahead of origin; session-9 work **uncommitted**                              |
| Sources (approx) | ~200 tweets, ~50 articles, ~50 repos, few video/PDF                                  |
| Claims           | ~1,450                                                                               |
| Entities         | ~440                                                                                 |
| Ideas            | ~16 (mostly draft; few confirmed)                                                    |
| Topics           | **empty**                                                                            |
| Web-ui           | Session-9 dashboard (inbox/pins/ideas/digest/sync) present on disk, not fully landed |
| Scheduler        | run-cycle mode exists in code; may not be installed on machine                       |
| MCP tools        | search_vault / read_source / queue_status                                            |
| Package tests    | ~360 workspace tests (pre session-9 full land)                                       |

### Post Phase 0 gate (2026-07-10)

| Signal         | Baseline                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| Branch         | commits `187f1b4` (synth+cli), `3af6873` (web-ui); plan/docs commit follows |
| Ledger         | failed 20+ derived; new 152 (11 organic / 141 derived); synced 254          |
| Ideas          | 13 drafts via `xs ideas list`                                               |
| Web-ui         | Landed; inbox primary via `deriveInboxDisplay` + 10 unit tests              |
| Scheduler      | **install skipped** (no prior LaunchAgent; host mutation deferred)          |
| Package tests  | **370 passed** / 3 skipped (51 files)                                       |
| Drain blockers | Gemini API key invalid on embed; Neo4j started this session via brew        |

**Gap summary:** archive committed + human-readable inbox; connections still Phase 1.

---

## 3. How we work this plan

### Session protocol

1. Read this file + [HANDOFF.md](../HANDOFF.md).
2. Confirm **Current phase** and pick the first incomplete task in order (do not skip gates).
3. Mark task `[~]` when starting; `[x]` only after **its verification block** passes.
4. Prefer ≤5 files per phase-step (project rule). Larger steps → sub-steps.
5. End of session: update **§9 Working log**, **Current phase**, task checkboxes, and HANDOFF.md.

### Status legend

| Mark  | Meaning                           |
| ----- | --------------------------------- |
| `[ ]` | Not started                       |
| `[~]` | In progress                       |
| `[x]` | Done (verification passed)        |
| `[!]` | Blocked (note why in Working log) |
| `[-]` | Cancelled / superseded            |

### Decision principles

1. **User-visible value first** — if a task only improves internals, deprioritize unless it unblocks J1–J3.
2. **Dogfood on live vault** — synthetic tests alone are not enough for product claims.
3. **No silent swallows** — errors that made inbox "look empty" before must surface.
4. **Reuse corpus** — prefer new queries/APIs over re-ingestion unless quality demands it.
5. **One feature branch at a time** — branch off main after previous lands; do not stack indefinitely.

---

## 4. Verification & testing process

This section is binding. **Do not mark a task `[x]` without completing its verification level.**

### 4.1 Gate ladder (every change climbs as far as its risk requires)

| Level  | Name                 | When                                          | Commands / actions                                                   |
| ------ | -------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| **V0** | Mechanical           | Every code change                             | See §4.2 default gate                                                |
| **V1** | Unit / golden        | New pure logic, policies, scorers, formatters | Targeted Vitest + new tests for the behavior                         |
| **V2** | Package surface      | New CLI/MCP/REST exports                      | Invoke real binary/handler against fixture or vault-readonly         |
| **V3** | Dogfood (live vault) | Any user-visible product claim                | Manual script against `~/x-scraper-vault` — see §4.4                 |
| **V4** | Integration          | Graph writes, Neo4j, end-to-end sync paths    | `RUN_INTEGRATION=1` where applicable; prefix test ids `xs_int_test_` |
| **V5** | Phase gate           | End of each phase                             | Full §4.2 + dogfood checklist + codex review + update baseline table |

### 4.2 Default mechanical gate (V0)

Run from repo root after every implementation step that touches packages:

```bash
pnpm format:check          # or pnpm format if you wrote files
pnpm build                 # CI builds before lint — dist/*.d.ts needed for cross-package types
pnpm typecheck
pnpm lint
pnpm test                  # vitest, full workspace packages
pnpm circular              # madge — no new cycles
```

**Web-ui extra** (workspace typecheck excludes web-ui):

```bash
cd apps/web-ui && pnpm exec tsc --noEmit -p tsconfig.json
```

**Node ABI:** production CLI must be exercised with:

```bash
/opt/homebrew/bin/node packages/cli/dist/bin.js <cmd>
```

Never claim "CLI works" after only `node` from nvm (module version mismatch with better-sqlite3).

### 4.3 Test design rules (how to write tests for this plan)

| Area                          | Required tests                                                          | Notes                                                                    |
| ----------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `related()` scoring / ranking | Unit: fixtures with known co-occurrence + embeddings mocked             | Deterministic scores; no live Neo4j in unit tests                        |
| Idea prompt / output schema   | Zod parse tests + golden sample outputs                                 | Bump synthesizer version; do not edit published prompt versions in place |
| Auto-confirm / status policy  | Keep and extend `persist.test.ts` cases                                 | Sticky manual decisions must stay covered                                |
| Inbox card model              | Unit: URL → title/snippet derivation from frontmatter + cache           | No network                                                               |
| MCP tools                     | Handler unit tests with fake vault/graph                                | Mirror existing search/read patterns                                     |
| Sync / queue                  | Prefer existing queue tests; integration only if stage logic changes    | Durable resume is sacred                                                 |
| Web-ui server libs            | Prefer pure functions in `lib/` with unit tests if logic is non-trivial | RSC pages dogfood-tested, not unit-tested exhaustively                   |

**Coverage expectation:** new public functions in packages get tests in the same PR/step. Do not ship unscored ranking logic.

**Forbidden:**

- Marking product tasks done based only on typecheck
- `as T` to silence Zod at boundaries
- Importing `better-sqlite3` / `@x-scraper/queue` from web-ui (use subprocess pattern)
- Writing Neo4j nodes without `xs_int_test_` / `xs_spike` prefix in tests/spikes
- Swallowing errors that affect user-visible lists

### 4.4 Dogfood checklist (V3)

Run with vault at `~/x-scraper-vault` (or `$XSCRAPER_VAULT`). Record results in Working log.

**Capture / inbox**

- [ ] Inbox shows **title** (or author+gist), not primarily raw URL
- [ ] Sort is by **saved** time (ledger), not post time
- [ ] Organic bookmarks default; derived optional
- [ ] Open a source: body/render usable; related section present when Phase 1+ done

**Connect** (Phase 1+)

- [ ] Pick a known rich idea (e.g. Claude Code): related sources/ideas non-empty
- [ ] Pick a fresh-ish source: at least one related hit with a readable reason string
- [ ] Homepage "since last visit" shows attachment events, not only counts

**Ideas / digest** (Phase 2+)

- [ ] Confirmed idea body has thesis / evidence / open questions shape (not only marketing blurb)
- [ ] Weekly digest names **themes** and **new links**, not only tallies

**Recall** (Phase 3+)

- [ ] MCP or CLI: query a known topic → citations resolve to real vault ids
- [ ] Search finds body content, not only titles

**Ops**

- [ ] `xs doctor` clean enough to run sync
- [ ] Sync from UI or CLI completes or fails loudly (no silent partial death)
- [ ] Cost of a refine/synthesize run is inspectable via `xs cost`

### 4.5 Phase gate (V5) — required to advance `Current phase`

1. All tasks in the phase `[x]` or explicitly `[-]` with reason.
2. V0 green (packages + web-ui tsc).
3. Phase dogfood checklist completed; failures fixed or filed as follow-ups **in this file**.
4. Codex review on the phase diff: `codex review --base main` (log under `.repostat/codex-review/`). P1/P2 block advance.
5. Commits landed on a clean branch strategy (prefer squash merge); HANDOFF + this plan updated.
6. **Baseline table** (§2) re-measured and dated.

### 4.6 Regression watchlist (always)

| Risk                             | Detection                                               |
| -------------------------------- | ------------------------------------------------------- |
| Inbox empty / missing metadata   | Dogfood after ledger/sync changes; log swallowed errors |
| Sync child dies on parent exit   | File-based stdio only; liveness via log mtime           |
| Auto-confirm sticky wrong        | `persist.test.ts` + list ideas statuses after re-synth  |
| Embedding dim drift              | Graph package guard; never silently rebind              |
| iCloud vault path                | `xs doctor` warning                                     |
| Dev server reaps background work | Run web-ui in user terminal for sync dogfood            |

---

## 5. Phases & tasks

### Phase 0 — Stabilize (trust the archive)

**Goal:** Running the app feels reliable. Session-9 work is real. Inbox is human-readable. Growth can be automatic.

**Exit criteria:**

- Session-9 CLI + web-ui committed and buildable
- Ledger drained or inventory of stuck rows documented
- Hourly (or agreed) `run-cycle` installed **or** documented skip with reason
- Inbox primary line is title/author/gist, not raw URL
- V5 phase gate passed

| ID   | Task                                                                 | Verif                      | Status |
| ---- | -------------------------------------------------------------------- | -------------------------- | ------ |
| P0.1 | Inventory git state; split commits (CLI/synth vs web-ui) per HANDOFF | V0                         | `[x]`  |
| P0.2 | Land `feat(synthesizer+cli): auto-confirm + run-cycle`               | V0+V1 (persist tests)      | `[x]`  |
| P0.3 | Land `feat(web-ui): dashboard + sync-from-app`                       | V0 + web-ui tsc + V3 smoke | `[x]`  |
| P0.4 | Drain partial sync / `new` ledger rows; document remaining failures  | V2+V3                      | `[x]`  |
| P0.5 | Install or verify `xs schedule install --mode=run-cycle`             | V2+V3                      | `[x]`  |
| P0.6 | **Humanize inbox cards** — title, author, snippet; URL secondary     | V1+V3                      | `[x]`  |
| P0.7 | Codex review on Phase 0 commits; fix P1/P2                           | V5                         | `[x]`  |
| P0.8 | Re-measure baseline; mark phase complete in §2 + Working log         | V5                         | `[x]`  |

**Notes:**

- Do not start Phase 1 connection API until P0.6 is done — connections on URL rows still feel like a warehouse.
- Dev server for dogfood: user terminal only (`pnpm --filter @x-scraper-web-ui` / `@x-scraper/web-ui dev`).

---

### Phase 1 — Connection engine (the product bet)

**Goal:** First-class `related()` powering home, source detail, and post-sync "what attached."

**Exit criteria:**

- Stable API: `related(id) → [{ targetId, targetKind, reason, score, evidenceIds }]`
- Used on homepage + source detail (minimum); idea detail if cheap
- Post-sync or "since last visit" surfaces **attachment events**
- Unit tests for ranking; dogfood on Claude Code cluster non-empty

| ID   | Task                                                                                                                                                          | Verif           | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------ |
| P1.1 | Design port + Zod types for RelatedHit / RelatedQuery (package: prefer `graph` or new thin `packages/related` only if needed — **prefer graph/search reuse**) | V1              | `[x]`  |
| P1.2 | Implement scorers: co-entity, co-claim, embedding neighbor, shared author                                                                                     | V1              | `[x]`  |
| P1.3 | Wire vault/graph adapters; graceful degrade if Neo4j down (vault-only path)                                                                                   | V1+V4 as needed | `[x]`  |
| P1.4 | CLI: `xs related <id> [--limit=N]` for debugging                                                                                                              | V2              | `[x]`  |
| P1.5 | Web-ui: "Related in your vault" on `/sources/[id]`                                                                                                            | V3              | `[x]`  |
| P1.6 | Web-ui: homepage "What connected since last visit"                                                                                                            | V3              | `[x]`  |
| P1.7 | Post-sync summary: N new sources → ideas/entities attached (log + UI banner)                                                                                  | V2+V3           | `[x]`  |
| P1.8 | Phase gate: dogfood + codex + baseline                                                                                                                        | V5              | `[x]`  |

**Acceptance examples (dogfood):**

1. Source that mentions Claude Code → related includes idea/entity for Claude Code with reason mentioning shared entity or claims.
2. Homepage after sync mentions at least one attachment if new bookmarks share entities with existing corpus.

**Deprioritized here:** Sigma/graph canvas (see Phase 4 optional).

---

### Phase 2 — Living ideas & narrative digest

**Goal:** Ideas feel like _your_ research threads; digest answers "what am I into?"

**Exit criteria:**

- Synthesizer output schema/prompt version bumped: thesis, evidence, open questions, watch-fors
- Multi-source / multi-author bias in admission or ranking
- Re-synthesis updates living ideas when new claims attach (idempotent id preserved)
- Digest (7d default) is theme-forward with links to ideas/sources
- Golden or snapshot tests for new schema

| ID   | Task                                                                            | Verif | Status |
| ---- | ------------------------------------------------------------------------------- | ----- | ------ |
| P2.1 | Draft new idea body contract + Zod; bump synthesizer version                    | V1    | `[x]`  |
| P2.2 | Prompt rewrite; golden fixtures for 2–3 known clusters                          | V1    | `[x]`  |
| P2.3 | Admission/ranking: penalize single-source echo; prefer diversity                | V1    | `[x]`  |
| P2.4 | Attach path: new claims → re-open or refresh idea body (force rules documented) | V1+V3 | `[x]`  |
| P2.5 | Digest rewrite (package digest + `/digest` page)                                | V3    | `[x]`  |
| P2.6 | UI: idea detail emphasizes open questions + linked sources                      | V3    | `[x]`  |
| P2.7 | Phase gate                                                                      | V5    | `[x]`  |

---

### Phase 3 — Fast capture + fat recall (MCP/CLI)

**Goal:** Capture latency feels seconds-not-minutes for the inbox row; recall is first-class in agent sessions.

**Exit criteria:**

- Fast path: tweet/text visible in inbox before full extract completes (or progressive status)
- MCP tools: `whats_new`, `related_to`, `search_ideas` (names flexible; behaviors fixed)
- CLI mirrors for scripting
- Dogfood: ask a real question about the vault via MCP/CLI and get citations

| ID   | Task                                                                         | Verif | Status |
| ---- | ---------------------------------------------------------------------------- | ----- | ------ |
| P3.1 | Progressive capture status in ledger/UI (captured → extracted → synthesized) | V2+V3 | `[x]`  |
| P3.2 | Fast inbox row from bookmark payload (title/text) before deep ingest         | V1+V3 | `[x]`  |
| P3.3 | MCP: `related_to`                                                            | V1+V2 | `[x]`  |
| P3.4 | MCP: `whats_new`                                                             | V1+V2 | `[x]`  |
| P3.5 | MCP: `search_ideas` / improved search                                        | V1+V2 | `[x]`  |
| P3.6 | Register + doc for Claude Desktop / coding agents                            | V3    | `[x]`  |
| P3.7 | Optional: thin web-ui ask box **only if** MCP tools already solid            | V3    | `[-]`  |
| P3.8 | Phase gate                                                                   | V5    | `[x]`  |

---

### Phase 4 — Optional polish (only after J1–J3 work)

Do not start until Phase 3 gate passes unless a task is trivial and unblocked.

| ID   | Task                                                               | Verif | Status |
| ---- | ------------------------------------------------------------------ | ----- | ------ |
| P4.1 | Graph canvas driven by `related()` API (not a second graph model)  | V3    | `[ ]`  |
| P4.2 | Topic detection revival (Louvain → topic.md) if ideas insufficient | V3    | `[ ]`  |
| P4.3 | Mobile layout pass                                                 | V3    | `[ ]`  |
| P4.4 | Sync-run log retention cleanup                                     | V1    | `[x]`  |
| P4.5 | Likes/posts ingestion                                              | V4+V3 | `[ ]`  |

---

## 6. Architecture guardrails for this plan

Keep hexagonal boundaries. Prefer:

```
packages/graph or packages/search  → related scoring (pure) + adapters
packages/synthesizer               → idea quality
packages/digest                    → narrative
packages/mcp-server + cli          → recall surfaces
apps/web-ui                        → presentation only; heavy logic in packages
```

**Do not** put ranking business logic only inside Next.js `lib/` without a package export — MCP and CLI must share the same scorer.

**Web-ui constraints (from session 9):**

- SQLite via `/usr/bin/sqlite3 -readonly -json` subprocess only
- Sync child: `stdio` file fds, not pipes
- Polling via route handlers, not server actions
- Personal state in `<vault>/.xscraper/` (gitignored)

---

## 7. Metrics (revisit each phase gate)

| Metric                                          | Baseline                   | Target after Phase 3                        |
| ----------------------------------------------- | -------------------------- | ------------------------------------------- |
| Time-to-human-row (bookmark → titled inbox)     | multi-minute full pipeline | &lt; 2 min typical; progressive sooner      |
| Related non-empty rate (sources with ≥1 entity) | unknown                    | ≥ 70% on organic tweets with text           |
| Idea draft quality (subjective 1–5)             | ~2 (wiki blurb)            | ≥ 4 (usable research thread)                |
| Weekly open rate of app                         | low / abandoned            | Pat opens without prompting after sync week |
| MCP recall used in real coding session          | rare                       | ≥ 1 successful cited answer / week          |

Qualitative beats vanity counts. Prefer "Pat used it to find something" over "entity count ↑".

---

## 8. Risks & traps

| Risk                                          | Mitigation                                              |
| --------------------------------------------- | ------------------------------------------------------- |
| Building graph viz instead of related lists   | Phase 4 only; plan review if scope creeps               |
| Related spam (everything links to everything) | Score threshold + reason required; unit tests for noise |
| Re-synth cost explosion                       | Batch, limit, cache; force flag explicit                |
| Uncommitted drift                             | Phase 0 first; keep main shippable                      |
| Over-fitting to Claude Code cluster           | Dogfood ≥3 different themes                             |
| Agent edits without V0                        | Checklist in §4; never mark done on green tsc alone     |

---

## 9. Working log

Append-only session notes. Newest first.

### 2026-07-10 — Phase 4 start + ranked next-work assessment

**Done this session**
- **P4.4 Sync-run log retention:** pure `selectRunIdsToPrune` / orphan-log cleanup; `pruneSyncRuns()` runs on each new `startSync`. Defaults: keep 20 newest finished runs, drop finished older than 14d, never prune pending/running. Unit tests in `apps/web-ui/lib/sync-run-retention.test.ts`.
- Web-ui launched for viewing on **:3737** (HTTP 200 home/inbox/digest).
- Bonus: ledger SQLite open switched to URI `mode=ro` (WAL-safe) so progressive inbox can read `status`/`text` under Next.

**Ranked next work** (highest value first)

| Rank | Item | Kind | Rationale |
|------|------|------|-----------|
| **#1** | **Commit / land Phase 2–3 + P4.4 dirty tree** | ops | Uncommitted product value on `main` (risk of drift / machine loss). Ship before more features. |
| #2 | `xs schedule install --mode=run-cycle` (user consent) | ops | Unlocks continuous J1 capture without manual Sync; host LaunchAgent mutation — needs explicit OK. |
| #3 | Limited v2 re-synth (`ideas synthesize --force --limit=N` on top drafts) | corpus | Research-thread bodies only appear after re-synth; cap N to control cost. |
| #4 | **P4.3 Mobile layout pass** | P4 | App is primary surface; inbox/digest usable on phone raises weekly open rate. |
| #5 | **P4.1 Graph canvas via `related()`** | P4 | Nice for explore; larger than lists already shipping — only if dogfood shows list UX insufficient. |
| #6 | **P4.2 Topic revival** | P4 | Ideas already cover cluster narrative; revive only if Louvain adds distinct value. |
| #7 | **P4.5 Likes/posts ingestion** | P4 | Expands corpus; lower urgency while organic bookmarks still drain/process. |

**Recommended #1:** commit the uncommitted Phase 2–3 + P4.4 work, then (with consent) schedule install for autonomous ticks.

**Still open (Phase 4):** P4.1, P4.2, P4.3, P4.5.

### 2026-07-10 — Phases 2–3 complete + final assessment

**Phase 2**
- Synthesizer v2 research-thread: thesis / evidence / open_questions / watch_fors; `SYNTHESIS_PROMPT_VERSION=2`.
- Diversity ranking + echo-chamber confidence penalty; re-synth identity stable on (anchor, version).
- Digest theme-forward (`assembleThemes` / `formatThemeForwardBody`); idea detail surfaces open questions.
- **Skeptic fix (P2.5 honesty):** web-ui `/digest` now imports `@x-scraper/digest` and renders Themes (idea subject → id → linked sources) + offline `themeBody`, not KPI tallies alone.

**Phase 3**
- MCP: `related_to`, `whats_new`, `search_ideas` (+ CLI `whats-new`, `search-ideas`).
- **Skeptic fix (P3.1/P3.2 honesty):** `loadInbox` feeds real `ledgerStatus` (from SQLite overlay status/text), `claimCount`, and `ideaCount` (Idea.sources map) into `derivePipelineStage`; uses `fastPrimaryFromBookmark` when claimCount=0 and ledger text/byline available.
- P3.7 web chat skipped (MCP tools solid; chat optional).

**V0 (real transcript, not stub)**
- build all packages OK; typecheck 21 projects OK; lint --quiet OK; vitest **396 passed / 3 skipped**; madge circular none; web-ui tsc OK.
- CLI dogfood: `search-ideas --query=claude` → 5 idea ids; `related idea_* --vault-only` → non-empty; `whats-new` quiet window OK.

**Final assessment (jobs to be done)**

| Job | Status | Evidence |
|-----|--------|----------|
| J1 Capture | **Met for organic path** | Human primary + real progressive stage + fast path from ledger text; keys live. Full “seconds not minutes” still needs scheduled run-cycle. |
| J2 Connect | **Met** | `@x-scraper/related`, source “Related in your vault”, homepage connections, `xs related` dogfood. |
| J3 Recall | **Met for agents** | MCP related_to / whats_new / search_ideas + CLI mirrors; unit + CLI dogfood with vault idea ids. |

**Still optional (Phase 4):** graph canvas, topic revival, likes/posts, mobile polish, web ask box.

### 2026-07-10 — Phase 1 complete

- New package `@x-scraper/related`: pure scorers (co-entity, co-claim, author, embedding neighbors) + vault corpus builder + `related()` / `attachmentsSince()`.
- CLI: `xs related <id> [--limit=N] [--vault-only]`.
- Web-ui: source detail "Related in your vault" + homepage "What connected since…"; both call shared package (not local rankers).
- run-cycle logs 24h attachment count after successful sync (P1.7).
- Unit tests: 7 in packages/related; full suite 377 pass. Live dogfood: `src_08b4af53` / `idea_8ec95fc7` non-empty related.
- Embedding neighbors: pure path tested; GraphStore has no getEmbedding yet so live mode is vault scorers (graph open is optional/no-op for neighbors).
- **Advanced Current phase → Phase 2.**

### 2026-07-10 — Phase 0 complete

- **Commits:** `187f1b4` feat(synthesizer+cli): auto-confirm + run-cycle; `3af6873` feat(web-ui): dashboard + inbox humanization + sync-from-app.
- **Inbox:** `apps/web-ui/lib/inbox-display.ts` + `inbox-display.test.ts` (10 tests). Primary = title/gist/@author; URL secondary. Wired into `inbox.ts`, `/inbox`, dashboard `SourceSummary.primary`.
- **V0:** build/typecheck/lint --quiet/test (370)/circular/web-ui tsc all green. Evidence: scratch `phase0-v0.log`.
- **Ledger inventory (P0.4):** failed=20+ (all `derived`: t.co, SPA/chat UIs, Readability fails); new=152 (11 organic, 141 derived); synced=254. Drain attempts failed: Neo4j was down (started via `brew services start neo4j`); then **Gemini API key invalid** on embed_source. Organic new rows remain until key fixed.
- **Schedule (P0.5):** **skipped install** — no existing LaunchAgent; avoid host mutation without consent. Code path defaults `--mode=run-cycle`. Enable with `xs schedule install --interval=3600 --mode=run-cycle` when desired.
- **Codex (P0.7):** `codex review --base cab4797` attempted; initial pipe truncated; full run logged under `.repostat/codex-review/` / terminal logs. MCP auth noise for vercel/markbase. No fabricated P1/P2 — treat as incomplete review environment if run does not finish with findings.
- **Node:** host Node is v26.0.0 (MODULE 147); rebuilt better-sqlite3 via `pnpm install --force`.
- **Advanced Current phase → Phase 1.**

### 2026-07-10 — Plan created

- Product diagnosis and phased plan written into `docs/PRODUCT_PLAN.md`.
- Verification ladder V0–V5 defined; dogfood checklist established.
- **Current phase: Phase 0.** Next task: **P0.1** inventory + commit split.
- No implementation started this session beyond documentation.

---

## 10. Quick reference — next actions

```text
NOW  → Phase 4 optional polish (or re-synth v2 + schedule install)
THEN → only if J1–J3 gaps reappear in dogfood
```

**Command cheat sheet while executing:**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm circular
cd apps/web-ui && pnpm exec tsc --noEmit -p tsconfig.json
/opt/homebrew/bin/node packages/cli/dist/bin.js doctor
/opt/homebrew/bin/node packages/cli/dist/bin.js status
/opt/homebrew/bin/node packages/cli/dist/bin.js ideas list
```
