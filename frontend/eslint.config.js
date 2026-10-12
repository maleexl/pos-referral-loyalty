/**
 * FILE: frontend/eslint.config.js
 * PURPOSE: ESLint v9 flat config for the frontend (React 19 + TS + Vite).
 *          Uses typescript-eslint recommended + react-hooks + react-refresh.
 *          Does NOT use eslint-plugin-react's legacy JSX rules — React 19's
 *          automatic JSX runtime makes "React must be in scope" obsolete.
 * CALLED BY: eslint CLI (npm run lint / lint:fix).
 * CALLS: @eslint/js, typescript-eslint, eslint-plugin-react-hooks,
 *        eslint-plugin-react-refresh, globals.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    // WHY: build + vendor output should never be linted; also skip the
    // committed TypeScript config files, which are consumed by the toolchain
    // rather than by the app.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // WHY: browser globals only — this is client code. If a Node-only
      // global leaks into app code, the linter catches it here.
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // WHY: Vite HMR only works when a module exports *only* components.
      // The rule warns when a hook or helper is exported alongside one,
      // which would silently break Fast Refresh.
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true }
      ],
      // WHY: mirror backend — explicit `import type` keeps ESM output clean.
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
);
