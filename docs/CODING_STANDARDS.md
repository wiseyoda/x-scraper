# Coding Standards

These standards are enforced by tooling where possible (eslint, prettier, tsc strict) and by codex review otherwise. Every PR is expected to comply.

## Formatting

- **Indentation**: 2 spaces (no tabs).
- **Line length**: 100 chars (prettier `printWidth: 100`). Hard cap 120 — long lines get refactored, not wrapped.
- **Trailing commas**: yes, in all multiline structures.
- **Semicolons**: yes (Node ESM TS).
- **Quotes**: single, double for JSX attributes (n/a here but stated for completeness).
- **Imports**: sorted by `eslint-plugin-simple-import-sort`. No deep relative imports (`../../../`) — use package imports across workspace boundaries.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- No `any` outside of explicit `// @ts-expect-error` lines with a reason.
- No `as` casts unless the runtime guarantee is documented in a comment on the same line.
- Prefer `type` over `interface` except for class implementors.
- Public package APIs export Zod schemas alongside types. Cross-package boundaries validate at the edge.

## Architecture

- **Hexagonal**: each package exposes ports (interfaces); adapters implement them. Consumers depend on the port, never on a concrete adapter.
- **No circular package imports**. Enforced by `madge` in CI.
- **No barrel re-exports** that hide module boundaries. Each public symbol has one canonical export path.
- **Functional core, imperative shell**: pure functions in `core/`, side effects (fs, network, db) only in adapter packages.
- **Immutability**: prefer `readonly` arrays/objects; `const` everywhere; no in-place mutation of caller-owned data.
- **Early returns** over nested conditionals.

## No magic numbers / strings

- Numbers used in logic (timeouts, thresholds, page sizes, retry counts) live in `packages/core/src/constants.ts` or per-module config files, named with intent.
  - **Bad:** `if (similarity > 0.85) { merge(); }`
  - **Good:** `if (similarity > MERGE_AUTO_THRESHOLD) { merge(); }` with `MERGE_AUTO_THRESHOLD = 0.85` and a comment on why.
- String enums (job stage names, edge types, prompt versions) live in const objects, not inline literals. eslint forbids inline string-enum literals at the boundary.
- Test fixtures may use literals freely — they document intent.

## Error handling

- Functions that can fail return `Result<T, E>` (use `neverthrow` or a tiny in-house wrapper) **or** throw typed errors. Pick one per package and stick to it.
- No silent `try { ... } catch {}`. Every catch logs (with structured context) and either rethrows, returns a Result, or has a comment explaining why swallowing is correct.
- External boundaries (network, fs, db, llm) always have retry-with-backoff at the adapter layer. Business logic above never retries.
- All thrown errors extend a per-package base class (`ScraperError`, `GraphError`, `LLMError`) with a stable `code` field for downstream pattern-matching.

## Hardening

- Validate **all external input** at the system edge with Zod: scraper outputs, LLM JSON outputs, REST/MCP request payloads, file frontmatter on read.
- LLM outputs are **never** trusted. Always Zod-validate. On parse failure, retry once with the validation error in the next prompt; then fail loudly.
- Prompts are **versioned** (semver-ish: extraction `v3.2`). Output schemas are pinned per prompt version. Bumping a prompt requires updating golden tests.
- Secrets only in `~/.config/x-scraper/.env` (chmod 600). Never in code, never logged, never in git. CI scans with `gitleaks`.
- File paths from external sources are normalized and confined to the vault root via a `safePath()` helper. Symlink traversal is rejected.
- HTTP requests have timeouts (default 30s). No fetch without `AbortSignal.timeout`.
- Database operations have their own timeouts. No unbounded queries.

## Performance

- No N+1 LLM calls. Batch where the API supports it (Gemini embeddings are batchable, Claude extraction is per-document — that's fine).
- Streaming I/O for files >1MB.
- HNSW vector index parameters chosen with a benchmark in `bench/`, not by gut.

## LLM call defaults

- **Be generous with `max_tokens`.** Default to 16k–32k for extraction-style calls, 4k–8k only for short reconciliation/decision prompts. A truncated response wastes the whole call. Cost-of-tokens-not-emitted is zero.
- **No artificial MIN_ thresholds in production prompts** (e.g. "extract at least 5 claims"). Let the model extract what's actually present; gate downstream on quality, not quantity.
- Use prompt caching (`cache_control: { type: 'ephemeral' }`) on the schema/system portion of any extraction call. Only the per-document portion should be uncached.
- Always check `stop_reason`. `max_tokens` ⇒ retry with a higher cap or split input. `refusal` ⇒ flag, don't silently treat as empty.

## Testing

- Public package APIs have ≥80% statement coverage via Vitest.
- Critical pipelines (entity resolution, reconciliation) have golden-corpus tests with stable seeds.
- Mocks at the adapter port boundary, not deep inside business logic.
- No test depends on network unless it's in `*.integration.test.ts`, gated by `RUN_INTEGRATION=1`.
- `pnpm test` runs unit + golden in <30s. Integration tests run nightly.

## Refactoring rules

- The "step 0" rule (per CLAUDE.md): before any structural refactor on a file >300 LOC, first remove dead code (unused props, exports, imports, debug logs) in a separate commit.
- A function over 50 lines is a smell; over 100 is a bug. Refactor or document why it must be long.
- A file over 300 LOC is a smell; over 600 is a bug. Split.
- Duplicated logic appearing in 3+ places gets extracted. Two places: leave it.
- "Senior dev override" applies — propose and implement structural fixes when the architecture is wrong, don't paper over.

## Comments

- **Default: no comments.** Names should explain.
- **Allowed**: a single line on the WHY when non-obvious — a hidden constraint, a workaround for a vendor bug, a subtle invariant. Reference the source (URL, ticket, commit).
- **Forbidden**: comments restating WHAT the code does. Comments referencing the current task ("added for Pat's sync feature"). Multi-paragraph docstrings.
- Public exports get a one-line JSDoc with the contract — input shape, output shape, side effects.

## Git

- Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `build:`, `ci:`).
- One logical change per commit. No "wip" commits in main.
- Squash-merge PRs to keep main linear.
- All commits signed and authored by Pat (or Co-Authored-By Claude with explicit attribution per the CLAUDE.md rules).

## CI gates (enforced on every PR)

1. `pnpm lint` — eslint with the package's config; zero warnings.
2. `pnpm typecheck` — `tsc --noEmit` across the workspace; zero errors.
3. `pnpm test` — Vitest unit + golden; all green.
4. `pnpm build` — every package builds.
5. `madge --circular` — zero cycles.
6. `gitleaks` — no secrets.
7. **codex review** — runs against the PR diff; must come back with no critical findings (see `docs/CODEX_REVIEW.md`).

## Codex review checkpoints

- After every spike completes: `codex review --base main` on the spike branch.
- After every roadmap slice merges to main: full-repo `codex review` covering the diff.
- Before any release tag: `codex challenge` (adversarial mode) on the most-recent slice.
- See `docs/CODEX_REVIEW.md` for the prompt template and what counts as a blocker vs an advisory.
