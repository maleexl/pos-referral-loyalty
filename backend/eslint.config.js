/**
 * FILE: backend/eslint.config.js
 * PURPOSE: ESLint v9 flat config for the backend (TypeScript + Node ESM).
 *          Uses typescript-eslint's recommended rules; no type-checked rules
 *          yet (kept fast for Sprint 2 — can be enabled later).
 * CALLED BY: eslint CLI (npm run lint / npm run lint:fix).
 * CALLS: @eslint/js, typescript-eslint.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // WHY: generated and vendored output should never be linted.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'prisma/migrations/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module'
    },
    rules: {
      // WHY: enforce explicit `import type` — keeps ESM output clean.
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
);
