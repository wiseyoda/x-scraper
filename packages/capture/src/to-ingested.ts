/**
 * CapturedSource → IngestedSource transform. Pure, no network, no LLM.
 *
 * Bridges the capture layer (raw + parsed forms) to the existing
 * extractor-input shape so the rest of the pipeline doesn't need to
 * change. Keeping the IngestedSource interface intact lets `xs refine`
 * and the live sync flow share the exact same downstream stages.
 */

import type { IngestedSource, IngestorKind } from '@x-scraper/ingestor';

import type { CapturedSource } from './types.js';

const CAPTOR_TO_KIND: Record<CapturedSource['content_type'], IngestorKind | 'tweet'> = {
  article: 'article',
  repo: 'repo',
  youtube: 'youtube',
  pdf: 'pdf',
  x_article: 'x-article',
  tweet: 'article', // tweets ride the article-shaped extractor input; ingestor 'kind' is a transport tag.
};

export const toIngestedSource = (captured: CapturedSource): IngestedSource => {
  const baseKind = CAPTOR_TO_KIND[captured.content_type];
  // Tweet content_type doesn't have a real ingestor kind (the ingestor
  // package doesn't ingest tweets); we tag them as 'article' for the
  // type, but the actual content_type for the Source.md frontmatter is
  // computed downstream from the URL.
  const kind: IngestorKind =
    captured.content_type === 'tweet' ? 'article' : (baseKind as IngestorKind);

  let metadata: Record<string, string | number | null> = {};
  switch (captured.content_type) {
    case 'article': {
      metadata = {};
      break;
    }
    case 'repo': {
      const m = captured.parsed.metadata;
      metadata = {
        owner: m.owner,
        repo: m.repo,
        defaultBranch: m.default_branch,
        stars: m.stars,
        language: m.language,
      };
      break;
    }
    case 'youtube': {
      const m = captured.parsed.metadata;
      metadata = {
        videoId: m.video_id,
        language: m.language,
        durationSec: m.duration_sec,
      };
      break;
    }
    case 'pdf': {
      metadata = {
        pageCount: captured.page_count,
      };
      break;
    }
    case 'x_article': {
      metadata = {
        ...(captured.parsed.metadata.tweet_id === null
          ? {}
          : { tweetId: captured.parsed.metadata.tweet_id }),
      };
      break;
    }
    case 'tweet': {
      metadata = {
        ...(captured.parsed.metadata.tweet_id === null
          ? {}
          : { tweetId: captured.parsed.metadata.tweet_id }),
      };
      break;
    }
  }

  return {
    url: captured.canonical_url,
    kind,
    title: captured.parsed.title,
    body: captured.parsed.body,
    byline: captured.parsed.byline,
    capturedAt: captured.fetched_at,
    metadata,
  };
};
