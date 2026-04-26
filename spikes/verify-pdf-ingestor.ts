/**
 * Live verification: ingest a real PDF from arXiv.
 *
 * Run with: pnpm spike spikes/verify-pdf-ingestor.ts
 */
import { createPdfIngestor } from '../packages/ingestor/src/pdf.js';

const URL = 'https://arxiv.org/pdf/1706.03762.pdf'; // "Attention Is All You Need"

const main = async (): Promise<void> => {
  const ingestor = createPdfIngestor();
  const start = Date.now();
  const source = await ingestor.ingest(URL);
  const elapsedMs = Date.now() - start;
  console.log(`fetched + parsed in ${String(elapsedMs)}ms`);
  console.log(`url: ${source.url}`);
  console.log(`kind: ${source.kind}`);
  console.log(`title: ${source.title ?? '(none)'}`);
  console.log(`captured at: ${source.capturedAt}`);
  console.log(`page count: ${String(source.metadata.pageCount)}`);
  console.log(`content-type: ${String(source.metadata.contentType)}`);
  console.log(`body length: ${source.body.length.toString()} chars`);
  console.log(`body preview:\n${source.body.slice(0, 400)}\n...`);
};

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
