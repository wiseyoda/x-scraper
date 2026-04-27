/**
 * Extraction prompt v2.
 *
 * Changes vs v1:
 *   - Tighter classification rules for type-specific entities. Repo
 *     requires a github.com URL; Article requires a non-x.com http
 *     URL; Video requires a YouTube URL; PDF requires a .pdf URL.
 *     Without a matching URL alias, classify as Concept (or Tool for
 *     software products with a vendor-controlled name). This stops
 *     the LLM from labeling websites and project names as Repo and
 *     leaves the linked-artifact entity types for cases where we can
 *     actually auto-ingest the artifact.
 *   - Encourages the model to include URLs in `aliases` when the
 *     source mentions them. The pipeline then enqueues those URLs
 *     for hard auto-expand into their own derived ledger rows.
 *
 * The schema text is embedded verbatim in the system block so:
 *   1) the model can be cached on it across calls (cache_control: ephemeral)
 *   2) it stays in lockstep with `schemas.ts` — runtime validation uses
 *      the same enums.
 */

import { ENTITY_TYPES_FOR_EXTRACTION, RELATIONSHIP_TYPES_FOR_EXTRACTION } from '../constants.js';

const ENTITY_UNION = ENTITY_TYPES_FOR_EXTRACTION.map((t) => `"${t}"`).join('|');
const RELATIONSHIP_UNION = RELATIONSHIP_TYPES_FOR_EXTRACTION.map((t) => `"${t}"`).join('|');

export const EXTRACTION_SYSTEM_V2 = `Return only valid JSON matching this TypeScript shape (no prose, no markdown fences):
{
  "entities": Array<{
    "id": string,            // stable slug used everywhere it appears (e.g. "claude-code")
    "type": ${ENTITY_UNION},
    "name": string,
    "aliases": string[]      // include canonical URLs when the source mentions them
  }>,
  "claims": Array<{
    "id": string,            // claim_<short-hash>
    "subject": string,        // entity id OR natural-language subject
    "predicate": string,      // snake_case verb-phrase like "uses_storage"
    "object": string,
    "text": string,           // sentence(s) supporting the claim
    "confidence": number      // 0..1
  }>,
  "relationships": Array<{
    "from": string,           // entity id
    "to": string,             // entity id
    "type": ${RELATIONSHIP_UNION}
  }>
}

Rules:
- Extract only what the source actually states. Do NOT invent URLs, version numbers, or stats.
- Use the same entity id consistently across claims and relationships.
- predicate must be snake_case verb-phrase like "uses_storage", "supports_model", "released_at".
- Be specific: prefer "Patchright is a stealth-patched Playwright fork" over "Patchright exists".
- Extract everything the source actually states. Quality over minimum count.

Type classification rules (strict):
- "Repo" REQUIRES a github.com URL (e.g. https://github.com/owner/repo) in name or aliases. Without a github URL, classify as "Tool" (software product) or "Concept" (idea/methodology). A bare project name or a website URL is NOT a Repo.
- "Article" REQUIRES a non-tweet http(s) URL alias pointing at the article being referenced. Do NOT extract the source-being-ingested ITSELF as an Article entity — the system tracks that separately. Only extract OTHER articles the source links to or quotes.
- "Video" REQUIRES a youtube.com or youtu.be URL alias.
- "PDF" REQUIRES a URL alias ending in .pdf.
- "Tweet" REQUIRES an x.com or twitter.com /<user>/status/<id> URL alias.
- "Person" for individuals (real people, X handles like @steipete count as Person).
- "Tool" for software products and named services (e.g. Vercel, Supabase, OpenClaw, Patchright).
- "Concept" is the catch-all for ideas, patterns, methodologies, project codenames, dataset names, and anything else with a name that doesn't fit a more specific type.

When the source mentions a URL for an entity, INCLUDE that URL in the entity's aliases. Downstream the pipeline uses those URL aliases to enqueue the linked artifact for ingestion (e.g. fetching a github repo's README), so omitting the URL costs us future content.`;

export const EXTRACTION_REPAIR_HINT_V2 = (previousError: string): string =>
  `Previous attempt failed schema validation: ${previousError}. Return strict JSON only.`;
