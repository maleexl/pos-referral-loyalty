# E2E tests (Playwright)

Acceptance coverage for the customer and staff journeys.
Specs drive the real frontend against the real backend; no mocks.

## Prerequisites

- One-time install: cd tests && npm install.
- The `webServer` block in the Playwright config starts the backend
  (http://localhost:3000, DB migrated + seeded) and the frontend
  (http://localhost:5173) on demand, and reuses them when they are
  already running (CI starts them explicitly before the run).

## Run

    cd tests
    npm test              # headless Chromium, single worker
    npm run test:headed   # watch the browser
    npm run test:ui       # Playwright UI mode

Override the frontend target without editing the config:

    E2E_FRONTEND_URL=http://localhost:4173 npm test

## Report

    npm run report

HTML report is written to tests/e2e/playwright-report/ (gitignored).

## Config

tests/e2e/playwright.config.ts -- one project (Chromium), 1 worker
(specs share one backend), list + html reporters, trace / screenshot /
video captured on failure only, `webServer` starts/reuses both dev servers.
