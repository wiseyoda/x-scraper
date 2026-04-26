# Contributing

This is a personal project, but the standards apply to anyone (and any AI agent) touching the codebase.

## Read first

1. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — design and stack
2. [`docs/CODING_STANDARDS.md`](./docs/CODING_STANDARDS.md) — non-negotiables
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — what's being built and in what order
4. [`docs/CODEX_REVIEW.md`](./docs/CODEX_REVIEW.md) — independent review at milestones

## Workflow

1. Pick a slice from the roadmap (or open an issue first if it's not in the roadmap).
2. Branch from `main`: `slice-N-short-description`.
3. Build the slice with tests. Keep commits small and Conventional.
4. Locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm circular`. All green.
5. Open a PR. CI must pass.
6. Run `codex review --base main` on the PR diff. Address all CRITICAL and MAJOR findings (or document the waiver).
7. Squash-merge.

## Commits

Conventional Commits, e.g. `feat(scraper): add bookmark cursor pagination`.

Allowed types: `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `perf`, `build`, `ci`.

## Issues

File one if you find a bug, want a feature, or disagree with a design choice. Tag with the relevant package or `roadmap`/`spike` label.
