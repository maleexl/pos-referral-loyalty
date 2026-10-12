# E2E tests (Playwright)

Owned by the QA team -- see the project docs.
Specs drive the real frontend against the real backend; no mocks.

## Prerequisites

- Backend running on http://localhost:3000 (DB migrated + seeded).
- Frontend running on http://localhost:5173.
- One-time install: cd tests && npm install.

Both servers are started externally (the CI job in STEP 2.1 will do this).

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
video captured on failure only.
