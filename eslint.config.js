// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      // The web-ui app has its own Next.js + ESLint setup; lint it from
      // its own package context (`pnpm --filter @x-scraper/web-ui build`
      // or `next lint`) rather than dragging Next-flavored sources into
      // the workspace-wide strict-type-checked profile.
      'apps/web-ui/**',
      '**/.next/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-magic-numbers': [
        'warn',
        {
          ignore: [-1, 0, 1, 2, 5, 10, 30, 60, 100, 1000],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['spikes/**/*.ts'],
    rules: {
      'no-magic-numbers': 'off',
      'no-console': 'off',
    },
  },
  {
    // CLI binaries print to stdout — that's their entire job.
    files: [
      'packages/cli/src/bin.ts',
      'packages/cli/src/commands/**/*.ts',
      'packages/rest/src/bin.ts',
      'packages/mcp-server/src/bin.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
