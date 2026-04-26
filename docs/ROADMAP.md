# Roadmap — testable slices

We build the whole system, but in slices that each end in a working, dogfoodable artifact and a codex review checkpoint. Spikes come first — they de-risk every external dependency before any production code is written.

Order: **Spikes 1–8 → Slice 0 → Slice 1 → ... → Slice 9 → Polish**.

Each slice ends with:

1. Green CI (lint + typecheck + test + build + madge + gitleaks).
2. Codex review on the slice diff; no critical findings.
3. A user-visible verification: a command you can run that exercises the new capability.

---

## Phase 0 — Foundation

### Slice 0.0 — Repo bootstrap (½ day)

- pnpm workspaces + tsconfig + eslint + prettier + vitest + tsup + commitlint.
- `.gitignore`, `.gitattributes`, MIT LICENSE, baseline README pointing at docs.
- GitHub Actions: lint, typecheck, test, build, madge, gitleaks, codex review hook.
- Push to `github.com/wiseyoda/x-scraper` (public).
- **Verify**: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green on a fresh clone.

### Spikes 1–8 (½–1 day each)

See [SPIKES.md](./SPIKES.md). Each spike is verified manually by you before we proceed. Spike outputs (fixtures, results notes) are committed to `spikes/`.

---

## Phase 1 — Core ingestion

### Slice 1 — `packages/scraper`: X auth + bookmarks fetch

- Cookie-import + Patchright-fallback auth (`xs auth login`).
- GraphQL bookmarks pagination (queryId discovery + cursor loop).
- Patchright rendered-page fallback when 429 or endpoint shape changes.
- Output: a stream of normalized `BookmarkRecord` objects (Zod-validated).
- Saves raw responses to `spikes/fixtures/...` for golden tests.
- **Verify**: `xs sync --source bookmarks --dry-run` prints the first 50 bookmarks as JSON.

### Slice 2 — `packages/vault` + `packages/core`: markdown vault + frontmatter codec

- Frontmatter Zod schemas for every entity type.
- `vault.read(id)`, `vault.write(record)`, `vault.list({type, since})`.
- Auto-init: `xs init` creates the vault, runs `git init`, writes `.gitignore`.
- Auto-commit on every write batch.
- **Verify**: `xs sync --source bookmarks` writes one source.md per bookmark and commits.

### Slice 3 — `packages/queue`: durable job queue + cost ledger

- SQLite-backed queue with stages, idempotency keys, retries, DLQ.
- `xs status` terminal dashboard.
- pino logger configured with daily file rotation.
- Cost-ledger schema in place (no LLM calls yet, table is empty).
- **Verify**: kill a sync mid-run; restart; queue resumes from where it left off.

---

## Phase 2 — Knowledge graph

### Slice 4 — `packages/graph` (Kùzu): schema + readonly queries

- Node and edge tables for the schema in ARCHITECTURE.md.
- Vector index on Claim and Entity embeddings.
- Read API: `graph.search({embedding, k})`, `graph.traverse({startId, depth, edgeTypes})`, `graph.communityOf(id)`.
- Migration: `xs reindex --from-vault` rebuilds the graph from markdown.
- **Verify**: insert 1k synthetic claims; vector search and 2-hop traversal under 100ms.

### Slice 5 — `packages/embeddings`: Gemini + adapter pattern

- `EmbeddingProvider` port; Gemini embedding-2-preview default; OpenAI text-embedding-3-large fallback.
- Batching, retry-with-backoff, cost-ledger integration.
- **Verify**: `xs embed-test` embeds a string and prints dimensions + similarity to a known reference.

### Slice 6 — `packages/llm` + `packages/extractor`: extraction

- `LLMProvider` port; Claude Sonnet 4.6 + Haiku 4.5 adapters with prompt caching.
- Versioned extraction prompts (`docs/PROMPTS/extraction-v1.md`).
- Zod-validated extraction output: entities, claims, relationships.
- Golden corpus: 10 hand-picked source markdowns + expected extraction JSON.
- **Verify**: `xs extract <source-id>` runs extraction; golden tests pass.

### Slice 7 — `packages/reconciler`: ER + ADD/UPDATE/DELETE/NONE

- Entity-resolution: vector candidate + LLM judge → MERGE/NEW/SAME_AS_PROBABLE.
- Reconciliation: per-claim ADD/UPDATE/DELETE/NONE with bi-temporal invalidation.
- Contradiction detection: same-(subject,predicate) clash → CONTRADICTS edge.
- Vault round-trip: every graph mutation also writes/updates markdown.
- Golden corpus: 20-bookmark fixture set with expected final graph state.
- **Verify**: ingest the 10-source corpus; assert deterministic graph; manual eyeball.

### Slice 8 — community detection + topic notes

- Leiden clustering via `graphology-communities-louvain` over the Concept/Topic subgraph.
- Periodic recluster + topic.md regeneration via Sonnet synthesis.
- Cross-topic RELATED_TO edges.
- **Verify**: after ingesting your real bookmarks, `xs list topics` shows coherent topic clusters; `cat vault/topics/<x>.md` reads as a sensible wiki.

---

## Phase 3 — Reach (linked content + auto-expand)

### Slice 9 — `packages/ingestor`: link types

- Article extractor (Readability + Patchright fallback).
- GitHub repo extractor (octokit + shallow clone for top-level + README).
- YouTube transcript extractor (`youtube-transcript` + `yt-dlp` fallback).
- PDF extractor (`pdfjs-dist`).
- All become `Source` records that join the same pipeline.
- **Verify**: ingest a bookmark linking to each type; assert proper extraction in the vault.

### Slice 10 — likes + own posts ingestion

- Same scraper module, additional source types (`likes`, `posts`).
- `xs sync --source likes,posts`.
- **Verify**: the vault gets your likes and your tweets ingested with proper provenance.

### Slice 11 — `packages/search` + auto-expand

- Exa, Tavily, Brave adapters behind `SearchProvider` port.
- High-signal heuristic: long thread / multi-link / technical-keyword density / re-engagement → triggers `discover_related`.
- New URLs canonicalized + dedup'd against vault before enqueueing.
- **Verify**: mark a bookmark `--deep`; observe 3–5 related URLs auto-ingested.

---

## Phase 4 — Surfaces

### Slice 12 — `packages/mcp-server`: full tool surface

- All MCP tools from ARCHITECTURE.md.
- Registered in Claude Code, Codex, Gemini CLI configs (via the doctor command).
- **Verify**: from a Claude Code session, `search`, `read`, `capture_url`, `summarize_topic` all work.

### Slice 13 — `packages/rest`: localhost API

- Hono REST server mirroring the MCP surface.
- Auth: bearer token from `~/.config/x-scraper/.env`, localhost-only by default.
- **Verify**: `curl localhost:7777/search?q=foo` returns the same shape as MCP.

### Slice 14 — `packages/cli`: `xs` polish

- All commands wired: `init`, `auth login`, `sync`, `status`, `review`, `cite`, `topic`, `reindex`, `cost`, `doctor`, `mcp`.
- `xs doctor` checks every adapter (auth, kuzu, gemini, claude, search backends, mcp registration).
- `xs review` interactive merge-decision queue.
- **Verify**: a fresh clone + `xs init` + `xs auth login` + `xs sync` end-to-end on this Mac.

### Slice 15 — digests + scheduled launchd

- Weekly DIGEST.md emitted by reconciler.
- `xs schedule install` writes a launchd plist for hourly sync.
- **Verify**: `digests/2026-W17.md` exists and reads well.

---

## Phase 5 — Polish + harden

### Slice 16 — bot-mitigation hardening

- Jittered cadence, session caps, queryId hot-reload, GraphQL→scrape fallback path tested under simulated 429.
- Nightly Playwright integration tests against your real account.

### Slice 17 — observability + perf

- `xs status` becomes a real TUI (ink or blessed).
- Bench suite for the hot paths (vector search, traversal, reconcile).
- Performance regression gate in CI (5% degradation fails).

### Slice 18 — docs + onboarding

- README with screencast, install steps, troubleshooting matrix.
- `docs/PROMPTS/` versioning convention finalized.
- HANDOFF.md for the next-time-you-touch-this state.

---

## Codex review schedule

| Checkpoint              | Command                                           |
| ----------------------- | ------------------------------------------------- |
| After each spike        | `codex review --base main` on spike branch        |
| After each slice merges | `codex review --base <prev-tag>` on slice diff    |
| Before each phase tag   | `codex challenge` adversarial mode on the phase   |
| Pre-1.0 release         | full-repo `codex review` + manual security review |

A blocking finding pauses the slice until fixed. Advisory findings open issues but don't block.

---

## Definition of Done (per slice)

- [ ] Code shipped in a feature branch.
- [ ] Lint + typecheck + test + build all green locally and in CI.
- [ ] Madge zero cycles.
- [ ] Gitleaks clean.
- [ ] `pnpm test` covers ≥80% statements in changed packages.
- [ ] Golden corpus updated if extraction/reconciliation behavior changed.
- [ ] User-visible verification command is documented and demonstrated.
- [ ] Codex review passes (no critical findings).
- [ ] Squash-merged to main with a Conventional Commit message.
- [ ] CHANGELOG.md updated.
