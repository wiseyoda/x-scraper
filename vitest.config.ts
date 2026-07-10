import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@x-scraper/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@x-scraper/vault': resolve(__dirname, 'packages/vault/src/index.ts'),
      '@x-scraper/queue': resolve(__dirname, 'packages/queue/src/index.ts'),
      '@x-scraper/graph': resolve(__dirname, 'packages/graph/src/index.ts'),
      '@x-scraper/scraper': resolve(__dirname, 'packages/scraper/src/index.ts'),
      '@x-scraper/embeddings': resolve(__dirname, 'packages/embeddings/src/index.ts'),
      '@x-scraper/llm': resolve(__dirname, 'packages/llm/src/index.ts'),
      '@x-scraper/extractor': resolve(__dirname, 'packages/extractor/src/index.ts'),
      '@x-scraper/reconciler': resolve(__dirname, 'packages/reconciler/src/index.ts'),
      '@x-scraper/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@x-scraper/ingestor': resolve(__dirname, 'packages/ingestor/src/index.ts'),
      '@x-scraper/search': resolve(__dirname, 'packages/search/src/index.ts'),
      '@x-scraper/mcp-server': resolve(__dirname, 'packages/mcp-server/src/index.ts'),
      '@x-scraper/rest': resolve(__dirname, 'packages/rest/src/index.ts'),
      '@x-scraper/digest': resolve(__dirname, 'packages/digest/src/index.ts'),
      '@x-scraper/observability': resolve(__dirname, 'packages/observability/src/index.ts'),
      '@x-scraper/community': resolve(__dirname, 'packages/community/src/index.ts'),
      '@x-scraper/related': resolve(__dirname, 'packages/related/src/index.ts'),
      '@x-scraper/synthesizer': resolve(__dirname, 'packages/synthesizer/src/index.ts'),
      '@x-scraper/capture': resolve(__dirname, 'packages/capture/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/**/*.{test,spec}.ts',
      'spikes/**/*.{test,spec}.ts',
      'apps/web-ui/**/*.{test,spec}.ts',
    ],
    // Integration tests are opt-in via RUN_INTEGRATION=1 because they need
    // live local services (Neo4j, etc). Excluding them in normal runs keeps
    // CI green; including them when the flag is set makes
    // `RUN_INTEGRATION=1 pnpm test packages/graph` actually run them.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...(process.env.RUN_INTEGRATION === '1' ? [] : ['**/*.integration.test.ts']),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10_000,
    passWithNoTests: true,
  },
});
