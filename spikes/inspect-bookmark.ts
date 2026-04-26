/**
 * Spike: dump one real bookmark's raw payload to stderr so we can see
 * what shape extractTweetPayload needs to handle. Run via:
 *   pnpm spike spikes/inspect-bookmark.ts
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { closeSession, fetchBookmarks, openAuthenticatedSession } from '@x-scraper/scraper';

const main = async (): Promise<void> => {
  const profileDir = path.join(os.homedir(), '.config', 'x-scraper', 'browser-profile');
  const session = await openAuthenticatedSession({ profileDir });
  try {
    const result = await fetchBookmarks(session, { source: 'bookmarks', maxBookmarks: 3 });
    process.stderr.write(`got ${String(result.records.length)} records\n`);
    for (const record of result.records.slice(0, 2)) {
      process.stderr.write(`\n=== entryId=${record.entryId} tweetId=${record.tweetId} ===\n`);
      process.stderr.write(JSON.stringify(record.raw, null, 2).slice(0, 4000));
      process.stderr.write('\n');
    }
  } finally {
    await closeSession(session);
  }
};

main().catch((err: unknown) => {
  process.stderr.write(String(err instanceof Error ? err.stack : err) + '\n');
  process.exit(1);
});
