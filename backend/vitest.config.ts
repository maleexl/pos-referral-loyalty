/**
 * FILE: backend/vitest.config.ts
 * PURPOSE: Vitest configuration for backend unit + integration tests.
 *          passWithNoTests keeps CI green while the test suite is still empty.
 * CALLED BY: vitest CLI (npm test / npm run test:watch).
 * CALLS: vitest/config.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // WHY: Node environment — no jsdom needed; backend has no browser globals.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // WHY: Sprint 1/2 has no tests yet; without this, CI fails on empty run.
    passWithNoTests: true,
    globals: false,
    reporters: 'default',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['dist', 'node_modules', 'tests/**', '**/*.config.*']
    }
  }
});
