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
    },
  },
  test: {
    include: ['packages/**/*.{test,spec}.ts', 'spikes/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
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
