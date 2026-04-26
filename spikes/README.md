# Spikes

Throwaway scripts that prove one risky integration before we commit to it. Each spike has a corresponding section in [`docs/SPIKES.md`](../docs/SPIKES.md) describing its goal, success criterion, and gate.

## Running a spike

```bash
pnpm spike spikes/1-auth.ts
```

## Layout

```
spikes/
├── README.md
├── RESULTS.md       # one paragraph per spike, written when it passes
├── fixtures/        # captured responses for golden-corpus tests
├── 1-auth.ts        # X.com auth + cookie import + browser fallback
├── 2-bookmarks.ts   # GraphQL pagination + scrape fallback
├── 3-kuzu.ts        # graph schema + vector index + traversal
├── 4-gemini.ts      # embedding-2-preview API
├── 5-claude.ts      # entity/claim extraction with Zod validation
├── 6-mcp.ts         # MCP server roundtrip
├── 7-readability.ts # article extraction + JS-page fallback
└── 8-codex.ts       # codex review on a deliberate small diff
```

Spike code is allowed to be ugly, log freely, and skip tests. The goal is to learn — production code re-implements what spikes prove.
