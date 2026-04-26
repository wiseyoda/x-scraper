# Codex Review Process

We use OpenAI Codex CLI as an independent reviewer at every milestone. Codex doesn't see our conversation history, so it's a fresh pair of eyes on the diff.

## When codex runs

| Trigger                            | Mode               | Command                           |
| ---------------------------------- | ------------------ | --------------------------------- |
| Spike branch ready                 | review             | `codex review --base main`        |
| Slice PR opened                    | review             | `codex review --base main`        |
| Pre-merge to main (after green CI) | review             | `codex review --base origin/main` |
| Phase tag                          | challenge          | `codex challenge`                 |
| Pre-1.0                            | review + challenge | both                              |

## Severity levels

- **CRITICAL** — security flaw, data loss risk, broken contract, missing input validation at a boundary. **Blocks merge.**
- **MAJOR** — architectural violation, magic numbers in logic, missing error handling, dead code. **Blocks merge unless explicitly waived in the PR with reasoning.**
- **MINOR** — style, naming, doc gap. **Filed as a follow-up issue, doesn't block.**
- **NIT** — purely stylistic preferences. **Ignored.**

## Review prompt template

When invoking codex review on a slice, prepend the following context to the diff:

```
This is x-scraper, a local-first knowledge graph built from X.com bookmarks.

Architecture: see docs/ARCHITECTURE.md (TS monorepo, Kùzu graph, Gemini embeddings,
Claude API, MCP server, markdown vault as canonical store).

Coding standards: see docs/CODING_STANDARDS.md.

Specifically check for:
1. Magic numbers in logic (any literal in conditional/threshold/timeout that isn't named)
2. Boundary input validation (Zod at edges; LLM outputs always validated)
3. Error handling: no silent catches; retries only at adapter boundaries
4. Hexagonal violations: business logic depending on concrete adapters
5. Hidden state mutation
6. Promise leaks (unawaited promises, missing AbortSignal)
7. Prompt-injection vulnerabilities in any path that splices user content into LLM prompts
8. Cost-ledger correctness (every LLM call recorded?)
9. Idempotency in queue stages
10. Test gaps in changed code

Skip: nits, formatting (prettier handles those), bikeshedding on naming.

Output format:
- One section per finding
- Severity tag (CRITICAL/MAJOR/MINOR/NIT)
- File:line reference
- One-paragraph explanation
- Concrete fix suggestion (code snippet if non-trivial)
```

## Adversarial mode (`codex challenge`)

Ask codex to actively try to break the slice:

- "What inputs cause this code to crash?"
- "What's the worst-case cost of a runaway prompt?"
- "How could a malicious tweet manipulate the LLM extraction prompt?"
- "What happens if Kùzu corrupts mid-write?"

Findings from challenge mode go in `docs/SECURITY_NOTES.md` even if patched immediately.

## Disagreeing with codex

Codex is wrong sometimes. When we disagree:

- Document the rejection in the PR thread with reasoning.
- If the disagreement is on architecture, update `ARCHITECTURE.md` with the rationale so future reviews don't re-litigate.
- If codex is wrong because of context it lacks, improve the prompt template above.

## Recording outcomes

Every codex run on a slice writes its raw output to `docs/codex/YYYY-MM-DD-slice-N.md` (gitignored beyond the latest 10). Lets us audit the trail.
