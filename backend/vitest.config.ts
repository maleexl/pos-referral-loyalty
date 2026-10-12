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
    // WHY: force NODE_ENV=test so src/db/prisma.ts selects the quiet log
    // profile. Without this, a local `npm test` without NODE_ENV exported
    // falls back to the dev profile and dumps expected P2002 errors.
    // WHY: deterministic test env — do NOT rely on shell state or a locally
    // present .env file. STAFF_API_KEY/ADMIN_API_KEY must match the values
    // used by tests calling /staff and /admin routes.
    env: {
      NODE_ENV: 'test',
      STAFF_API_KEY: 'test_staff_key',
      ADMIN_API_KEY: 'test_admin_key'
    },
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
