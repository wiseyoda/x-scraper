/**
 * Extraction prompt v1.
 *
 * The schema text is embedded verbatim in the system block so:
 *   1) the model can be cached on it across calls (cache_control: ephemeral)
 *   2) it stays in lockstep with `schemas.ts` — runtime validation uses
 *      the same enums.
 *
 * Versioning: bump the constant in `constants.ts` and add a sibling file
 * (extraction-v2.ts) when you change a field name, an enum, or the rules.
 * Never edit a published version in place.
 */

import { ENTITY_TYPES_FOR_EXTRACTION, RELATIONSHIP_TYPES_FOR_EXTRACTION } from '../constants.js';

const ENTITY_UNION = ENTITY_TYPES_FOR_EXTRACTION.map((t) => `"${t}"`).join('|');
const RELATIONSHIP_UNION = RELATIONSHIP_TYPES_FOR_EXTRACTION.map((t) => `"${t}"`).join('|');

export const EXTRACTION_SYSTEM_V1 = `Return only valid JSON matching this TypeScript shape (no prose, no markdown fences):
{
  "entities": Array<{
    "id": string,            // stable slug used everywhere it appears (e.g. "claude-code")
    "type": ${ENTITY_UNION},
    "name": string,
    "aliases": string[]
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
- Extract everything the source actually states. Quality over minimum count.`;

export const EXTRACTION_REPAIR_HINT = (previousError: string): string =>
  `Previous attempt failed schema validation: ${previousError}. Return strict JSON only.`;
