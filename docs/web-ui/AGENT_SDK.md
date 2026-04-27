# Agent SDK integration

How the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) plugs into
the web app to power read-mode research and write-mode ingest.

## Two flows, one agent loop

The web app surfaces two user-initiated agent flows; both share the
same `query()` loop and the same in-process MCP tool catalog. The
difference is which tools are _allowed_.

### Read flow — "ask the corpus"

User types a question. Agent gets read-only tools and must answer
purely from existing graph + vault content. Citations are returned as
structured tool-call results that the UI renders as click-through
chips ("see [[src_a1b2c3d4]]"). Budgeted small (`maxBudgetUsd: 0.10`,
`maxTurns: 10`).

Examples:

- "What did anyone say about Patchright last month?"
- "Summarize the closed-loop architecture from the OpenClaw article."
- "Which entities are most often co-mentioned with `claude-code`?"

### Write flow — "research this and ingest it"

User points the agent at a URL, repo, or topic. Agent gets read +
write tools: it can `fetch_url`, `ingest_url` (running the existing
extractor), and `search_web` (Exa/Tavily/Brave via the existing
`@x-scraper/search` package). After each ingest it can re-query the
graph to verify the new content landed correctly. Larger budget
(`maxBudgetUsd: 1.00`, `maxTurns: 30`).

Examples:

- "Pull this github repo and any recent posts that mention it."
- "I just bookmarked 5 X posts about agent frameworks — process them
  and tell me which themes are new."
- "Find the original paper this article cites and ingest it."

## Architecture

```
Client (<AgentChat />)
  ↓ POST /api/agent  { prompt, mode: 'read'|'write', sessionId? }
Route Handler (app/api/agent/route.ts)
  → features/agent/runner.ts
    → @anthropic-ai/claude-agent-sdk query()
        with in-process MCP server (createSdkMcpServer)
        and allowedTools scoped by mode
    → for-await of message events
    → write events to ReadableStream
    → persist tool_calls + final result to SQLite (agent_sessions table)
  ↑ ReadableStream of NDJSON events
Client (<AgentChat />)
  ← Vercel AI SDK useChat parses the stream into messages
  ← UI renders text deltas, tool calls, costs
```

### Why custom in-process tools, not REST or MCP-over-stdio

The existing repo has `xs-rest` (Hono REST mirror) and `xs-mcp` (MCP
stdio server). Neither is the right transport for the embedded agent:

- **REST**: every tool call is a network round-trip (~50-200ms each)
  plus serialization. With 5-10 tool calls per turn over 10 turns,
  that's 5-20 seconds of pure transport latency.
- **MCP stdio**: sub-process IPC, marginally better than REST but
  still has serialization overhead and complicates session lifetime.
- **In-process tools** via `createSdkMcpServer({ tools: [...] })` call
  the TS modules directly. Sub-millisecond. The Agent SDK's
  recommended pattern for Node-based agents.

The `xs-rest` and `xs-mcp` servers stay around for IDE / external
integrations. The web app's agent uses in-process tools.

## Tool catalog

Defined in `features/agent/tools.ts`. Each tool is a Zod-validated
function with structured input + output. `readOnlyHint: true` is set
on every read tool so the SDK can parallelize them.

### Read tools (always allowed)

| Tool                     | Input                                                  | Output                                   | Backed by                                            |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------- |
| `search_graph_text`      | query: string, type?: EntityType, limit: number        | rows of {id, type, name, score, snippet} | hybrid Cypher + vector search via `@x-scraper/graph` |
| `vector_search_entities` | text: string, type?, limit                             | rows of {id, type, name, score}          | `graph.vectorSearch()` over `entity_embed_idx`       |
| `read_source`            | id: string                                             | full Source.md frontmatter + body        | `vault.read(id, 'Source')`                           |
| `read_entity`            | id: string                                             | full Entity.md (with sources backlinks)  | `vault.read(id, type)`                               |
| `read_claim`             | id: string                                             | full Claim.md                            | `vault.read(id, 'Claim')`                            |
| `traverse`               | startId: string, depth: number, edgeTypes?: EdgeType[] | walk steps                               | `graph.traverse()`                                   |
| `cypher_read`            | query: string (read-only enforced), params: object     | rows                                     | `graph.runReadCypher()` (new method, blocks writes)  |
| `xs_status`              | —                                                      | queue counts                             | `queue.stats()`                                      |
| `xs_trends`              | topN: number                                           | trends snapshot                          | `runTrends()`                                        |

### Write tools (allowed in `write` mode only)

| Tool             | Input                            | Output                                        | Backed by                                              |
| ---------------- | -------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `ingest_url`     | url: string                      | summary {sourceId, claims, entities, costUsd} | `runSync({ urls: [url] })`                             |
| `fetch_web_text` | url: string                      | rendered text + title (no graph write)        | `ingest()` from `packages/ingestor` (article ingestor) |
| `search_web`     | query: string, providers?        | search results                                | `@x-scraper/search` (Exa/Tavily/Brave)                 |
| `merge_entities` | aId: string, bId: string         | merged graph + vault state                    | new method on `EntityMerger`                           |
| `retag_source`   | sourceId: string, tags: string[] | updated frontmatter                           | direct vault write + git commit                        |

### Tool definition example

```ts
// features/agent/tools.ts
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { graphStore } from '@/lib/neo4j';
import { vaultStore } from '@/lib/vault';

export const searchGraphText = tool(
  'search_graph_text',
  'Hybrid keyword + vector search over Source / Entity / Claim nodes. Returns top matches with type, name, and a short snippet.',
  {
    query: z.string().describe('What to search for'),
    type: z.enum(['Source', 'Entity', 'Claim']).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  },
  async ({ query, type, limit }) => {
    const rows = await graphStore.hybridSearch({ query, type, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
    };
  },
  { annotations: { readOnlyHint: true } },
);

export const ingestUrl = tool(
  'ingest_url',
  'Fetch a URL, extract claims and entities, reconcile with the existing graph, and persist to vault + Neo4j. Returns a summary of what was added.',
  {
    url: z.string().url(),
    sourceKind: z.enum(['bookmarks', 'likes', 'posts']).default('bookmarks'),
  },
  async ({ url, sourceKind }) => {
    try {
      const result = await runAdHocSync({ url, sourceKind });
      return {
        content: [
          {
            type: 'text',
            text: `Ingested ${url}\n  source_id: ${result.sourceId}\n  claims: ${result.claims}\n  entities: ${result.entities}\n  cost: $${result.costUsd.toFixed(4)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);
```

## Streaming wiring

The Agent SDK's `query()` returns an async iterator of message events.
Wrap it in a `ReadableStream` inside the route handler and let the AI
SDK on the client parse it.

```ts
// app/api/agent/route.ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createReadOnlyServer, createReadWriteServer } from '@/features/agent/runner';
import { persistSession } from '@/features/agent/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { prompt, mode, sessionId } = await req.json();
  const server = mode === 'write' ? createReadWriteServer() : createReadOnlyServer();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      let totalCost = 0;
      const toolCalls: ToolCall[] = [];
      try {
        for await (const msg of query({
          prompt,
          options: {
            includePartialMessages: true,
            allowedTools: server.allowedTools,
            maxTurns: mode === 'write' ? 30 : 10,
            maxBudgetUsd: mode === 'write' ? 1.0 : 0.1,
            ...(sessionId ? { resume: sessionId } : {}),
          },
          mcpServers: { xscraper: server.mcp },
        })) {
          controller.enqueue(enc.encode(JSON.stringify(msg) + '\n'));
          if (msg.type === 'result') {
            totalCost = msg.total_cost_usd ?? 0;
            await persistSession(msg.session_id, { totalCost, toolCalls, prompt });
          } else if (
            msg.type === 'stream_event' &&
            msg.event.type === 'content_block_start' &&
            msg.event.content_block?.type === 'tool_use'
          ) {
            toolCalls.push({
              name: msg.event.content_block.name,
              startedAt: Date.now(),
            });
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson' },
  });
}
```

Client side, the AI SDK's `useChat` accepts a custom `streamProtocol`,
or we go raw `fetch + ReadableStream + parse NDJSON`. For an internal
app the raw approach is simpler and gives complete control over what
each event renders as.

## Session persistence

Schema added to the existing `queue.sqlite` (or a new sibling
`agents.sqlite`):

```sql
CREATE TABLE agent_sessions (
  session_id TEXT PRIMARY KEY,        -- from result.session_id
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('read','write')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  total_cost_usd REAL DEFAULT 0,
  num_turns INTEGER,
  final_result TEXT,                  -- last assistant message text
  status TEXT NOT NULL DEFAULT 'running'
);

CREATE TABLE agent_tool_calls (
  call_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id),
  turn INTEGER,
  tool_name TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  recorded_at TEXT NOT NULL
);

CREATE INDEX agent_sessions_recent_idx ON agent_sessions (created_at DESC);
CREATE INDEX agent_tool_calls_session_idx ON agent_tool_calls (session_id);
```

Sessions are resumable via the SDK's `resume: sessionId` option — no
need to re-feed the corpus context. The `/chat/[sessionId]` page
replays a session by reading these tables, with a "Continue this
session" button that POSTs back to `/api/agent` with the session id.

## Cost ledger

Every tool call's input/output is logged to `agent_tool_calls`. The
final `result` message carries `total_cost_usd` from the SDK; we
persist that on the session row. A `<CostMeter />` in the chat UI
shows running spend live (decoded from `stream_event` deltas) and the
final figure when the run completes.

The agent's spend is folded into the existing `cost_ledger` SQLite
table via the existing `LlmCostSink` interface (already wired into
every Anthropic call from `@x-scraper/llm`). This keeps `xs cost` as
the single source of truth for total spend across CLI + web.

## Safety / scoping

Three independent guardrails for the write flow:

1. **`maxBudgetUsd`** on every `query()` call. Caps spend per session;
   the SDK terminates the loop when reached.
2. **`allowedTools` scope.** Read mode never sees `ingest_url`,
   `merge_entities`, or `retag_source`. Enforced at the SDK level —
   the model literally cannot call them.
3. **PreToolUse hook** logs and (for `ingest_url`) requires the URL to
   be on a small allowlist of hosts, OR shows a confirmation dialog
   in the UI before letting the tool execute. Defense in depth in case
   the user changes mode mid-session.

The `cypher_read` tool wraps Neo4j in a read-only session
(`session({ defaultAccessMode: neo4j.session.READ })`) so even if
prompt-injection lands a write Cypher, it'll be rejected by the driver.

## Anti-patterns to avoid

1. **Don't re-instantiate the agent per request.** The SDK is meant to
   be long-lived; spinning a fresh `query()` per request is fine, but
   the in-process MCP server should be a module-level singleton so we
   don't re-build the tool table 50 times per chat session.
2. **Don't expose `cypher_write` as a tool.** Even with `maxBudgetUsd`
   and `maxTurns` caps, "let the model run arbitrary Cypher" is a
   foot-gun. Mutations go through typed write tools (`merge_entities`,
   `retag_source`).
3. **Don't trust `total_cost_usd` for billing.** It's an estimate. For
   real cost, query the existing `cost_ledger` after the session
   finishes — every Anthropic call records actual usage there.
4. **Don't load full source bodies into the system prompt.** Tool call
   `read_source` is on-demand. If the agent needs the body it asks
   for it; otherwise it works from search snippets and metadata. Keeps
   per-turn context small.
5. **Don't skip `revalidatePath`.** When the write flow ingests a new
   URL, any RSC pages showing source counts / entity lists become
   stale. The route handler calls `revalidateTag('sources')` etc.
   after each successful `ingest_url`.

## References

- [Claude Agent SDK — agent loop](https://docs.claude.com/en/api/agent-sdk/agent-loop)
- [Custom tools / `createSdkMcpServer`](https://docs.claude.com/en/api/agent-sdk/custom-tools)
- [Streaming output](https://docs.claude.com/en/api/agent-sdk/streaming-output)
- [Cost tracking](https://docs.claude.com/en/api/agent-sdk/cost-tracking)
- [Session resumption](https://docs.claude.com/en/api/agent-sdk/sessions)
- [Vercel AI SDK + Anthropic provider](https://ai-sdk.dev/v5/providers/ai-sdk-providers/anthropic)
