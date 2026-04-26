/**
 * Cross-package constants. Only put things here that genuinely span
 * package boundaries (entity types, edge types, vault layout names);
 * package-local thresholds belong in each package's own constants.ts.
 */

export const ENTITY_TYPES = [
  'Person',
  'Tool',
  'Concept',
  'Repo',
  'Topic',
  'Article',
  'Tweet',
  'Video',
  'PDF',
  'Source',
  'Claim',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const EDGE_TYPES = [
  // Provenance
  'EXTRACTED_FROM',
  'AUTHORED_BY',
  'MENTIONED_IN',
  'CITED_BY',
  // Semantic
  'IS_A',
  'PART_OF',
  'INSTANCE_OF',
  'RELATED_TO',
  // Epistemic
  'SUPPORTS',
  'CONTRADICTS',
  'SUPERSEDES',
  'EVOLVED_FROM',
  // Behavioral
  'LEARNED_FROM',
  'REFERENCED_WHILE_BUILDING',
  // Tentative (entity resolution)
  'SAME_AS_PROBABLE',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const SOURCE_KIND = ['bookmarks', 'likes', 'posts'] as const;
export type SourceKind = (typeof SOURCE_KIND)[number];

export const VAULT_DIRS = {
  sources: 'sources',
  sourcesTweets: 'sources/tweets',
  sourcesArticles: 'sources/articles',
  sourcesRepos: 'sources/repos',
  sourcesVideos: 'sources/videos',
  sourcesPdfs: 'sources/pdfs',
  claims: 'claims',
  entities: 'entities',
  topics: 'topics',
  digests: 'digests',
  internal: '.xscraper',
} as const;

export const ID_PREFIXES = {
  Source: 'src',
  Claim: 'claim',
  Topic: 'topic',
  Person: 'p',
  Tool: 'tool',
  Concept: 'c',
  Repo: 'repo',
  Article: 'art',
  Tweet: 'tw',
  Video: 'vid',
  PDF: 'pdf',
} as const satisfies Partial<Record<EntityType, string>>;
