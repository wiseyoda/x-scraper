/**
 * Dispatcher: picks the right ingestor for a URL.
 *
 * Order matters — repo/youtube are tried before article so a github.com
 * URL doesn't get scraped as a generic web page.
 */

import { type Ingestor, IngestorError } from './types.js';

export const selectIngestor = (url: string, ingestors: Ingestor[]): Ingestor => {
  for (const ingestor of ingestors) {
    if (ingestor.matches(url)) return ingestor;
  }
  throw new IngestorError(`no ingestor matched ${url}`, 'UNSUPPORTED_URL', { url });
};

export const ingest = async (
  url: string,
  ingestors: Ingestor[],
): Promise<ReturnType<Ingestor['ingest']> extends Promise<infer T> ? T : never> => {
  const target = selectIngestor(url, ingestors);
  return target.ingest(url);
};
