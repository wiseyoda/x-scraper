/**
 * Extraction prompt v3.
 *
 * Changes vs v2:
 *  - Hard claim cap: 5–15 substantive claims. v2 was producing 40+
 *    claims per README — every install URL, every shell command, every
 *    bullet point. The result was a flat soup of granular facts that
 *    didn't cluster across sources. v3 asks for the smaller set of
 *    claims a knowledgeable reader would highlight.
 *  - Concept-anchored subjects. The extractor was anchoring claims on
 *    per-source identifiers (`claude-code`, `anthropic-cookbook`) so
 *    cross-source clustering missed the meatier shared topics. v3
 *    instructs the model to prefer broader concept-level subjects when
 *    the same point is made across multiple framings, and to use the
 *    entity name (e.g. "Claude Code") rather than the slug
 *    (`claude-code`) when both refer to the same thing.
 *  - Drop trivial-derivable claims. Install URLs, license names,
 *    repo metadata, "released_at" dates already live in
 *    Source.frontmatter / capture metadata; restating them as L0
 *    claims is noise.
 *  - Type consistency: prefer Tool over Person for organizations
 *    (Anthropic = Tool, not Person). Person is reserved for
 *    individuals and X handles.
 *
 * The schema text is embedded verbatim in the system block so:
 *   1) the model can be cached on it across calls (cache_control: ephemeral)
 *   2) it stays in lockstep with `schemas.ts` — runtime validation uses
 *      the same enums.
 */

import { ENTITY_TYPES_FOR_EXTRACTION, RELATIONSHIP_TYPES_FOR_EXTRACTION } from '../constants.js';

const ENTITY_UNION = ENTITY_TYPES_FOR_EXTRACTION.map((t) => `"${t}"`).join('|');
const RELATIONSHIP_UNION = RELATIONSHIP_TYPES_FOR_EXTRACTION.map((t) => `"${t}"`).join('|');

export const EXTRACTION_SYSTEM_V3 = `Return only valid JSON matching this TypeScript shape (no prose, no markdown fences):
{
  "entities": Array<{
    "id": string,            // stable slug used everywhere it appears (e.g. "claude-code")
    "type": ${ENTITY_UNION},
    "name": string,           // display form (proper case for orgs/tools, e.g. "Claude Code", not "claude-code")
    "aliases": string[]       // include canonical URLs when the source mentions them
  }>,
  "claims": Array<{
    "id": string,             // claim_<short-hash>
    "subject": string,         // ENTITY NAME (e.g. "Claude Code"), not slug — see rules below
    "predicate": string,       // snake_case verb-phrase like "uses_storage"
    "object": string,
    "text": string,            // sentence(s) supporting the claim
    "confidence": number       // 0..1
  }>,
  "relationships": Array<{
    "from": string,            // entity id
    "to": string,              // entity id
    "type": ${RELATIONSHIP_UNION}
  }>
}

Output rules — read carefully, the system depends on these:

1. CLAIM COUNT: Emit 5–15 substantive claims for a typical README-length source. Quality, not coverage. Skip:
   - Install commands ("brew install x", "npm install y") — these live in the source body, not the knowledge layer.
   - Trivial metadata (license names, version numbers, default branch, star counts) — already captured in source metadata.
   - Per-platform installation URLs — one claim "X supports installation via curl/brew/winget" beats five separate URL claims.
   - Bullet-point feature lists where each line is its own claim. Aggregate to one claim about the capability cluster.

2. SUBJECT NAMING: subject MUST be the entity NAME (display form) when the claim is about a named entity. Use "Claude Code" not "claude-code"; "Anthropic" not "anthropic"; "AI Agents" not "ai-agents". This is critical for cross-source clustering — slug-form subjects fragment ideas across sources.

3. PREFER CONCEPT-LEVEL SUBJECTS when the source talks about a broader idea. A claim like "The repository teaches prompt engineering through interactive notebooks" should anchor on "Prompt Engineering" (or the source's specific concept), not on the repo name.

4. EXTRACT-DON'T-INVENT: Only what the source actually states. Never fabricate URLs, version numbers, dates, or stats.

5. CONSISTENT IDS: Use the same entity id consistently across claims and relationships. id is a stable slug; name is the display form.

Type classification rules (strict — do NOT relax these):
- "Repo" REQUIRES a github.com URL (e.g. https://github.com/owner/repo) in name or aliases. Without a github URL, classify as "Tool" or "Concept". A bare project name or website URL is NOT a Repo.
- "Article" REQUIRES a non-tweet http(s) URL alias pointing at the article. Do NOT extract the source-being-ingested ITSELF as an Article — the system tracks that separately.
- "Video" REQUIRES a youtube.com or youtu.be URL alias.
- "PDF" REQUIRES a URL alias ending in .pdf.
- "Tweet" REQUIRES an x.com or twitter.com /<user>/status/<id> URL alias.
- "Person" for individuals only — real people, X handles like @steipete count as Person.
  ORGANIZATIONS (Anthropic, OpenAI, Vercel, Mozilla) are "Tool" — they're vendor-controlled named services, not individuals.
- "Tool" for software products, services, AND organizations (Anthropic, Vercel, Supabase, Patchright).
- "Concept" is the catch-all for ideas, patterns, methodologies, project codenames, dataset names, anything else with a name that doesn't fit a more specific type.

When the source mentions a URL for an entity, INCLUDE that URL in the entity's aliases. Downstream the pipeline uses those URL aliases to enqueue the linked artifact for ingestion.`;

export const EXTRACTION_REPAIR_HINT_V3 = (previousError: string): string =>
  `Previous attempt failed schema validation: ${previousError}. Return strict JSON only.`;
