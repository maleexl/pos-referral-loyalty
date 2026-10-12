/**
 * FILE: tests/e2e/customer-flow.spec.ts
 * PURPOSE: E2E happy path for the Sprint 3 customer journey — register a new
 *          customer on /customer, verify the referral card renders (code,
 *          zero balance, empty list), then invite a referee friend.
 * CALLED BY: `npx playwright test` via tests/e2e/playwright.config.ts.
 * CALLS: @playwright/test; frontend at baseURL (default :5173) which talks
 *        to backend at :3000 (both started externally).
 * DEPS: frontend Customer page — impl @ 5651b05, base testids @ ca08710,
 *       additional testids (register-phone/-name, referee-email/-phone/-name,
 *       referee-success) pending follow-up Frontend commit.
 */

import { test, expect } from '@playwright/test';

test.describe('Customer flow — register then invite a referee', () => {
  // Unique per run so the suite is rerunnable against the same DB.
  // Phone digits derive from the same UUID as the email so a failure
  // report can be traced back to a single run.
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const seed  = parseInt(runId, 16);
  const phoneSuffix = (n: number) => String(n % 1_000_000_000).padStart(9, '0');

  const customer = {
    email: `test-customer-${runId}@example.com`,
    phone: `0${phoneSuffix(seed)}`,
    name:  `E2E Customer ${runId}`,
  };
  const referee = {
    email: `test-referral-${runId}@example.com`,
    phone: `0${phoneSuffix(seed + 1)}`,
    name:  `E2E Referee ${runId}`,
  };

  test.beforeEach(async ({ page }) => {
    // Clear localStorage before any app script runs, so a stale
    // referralCode from a prior test cannot hide the register form.
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/customer'); // resolves against baseURL in config
  });

  test('registers a customer and invites a referee', async ({ page }) => {
    // ── 1. Register ────────────────────────────────────────────────
    await expect(page.getByTestId('register-form')).toBeVisible();
    await page.getByTestId('register-email').fill(customer.email);
    await page.getByTestId('register-phone').fill(customer.phone);
    await page.getByTestId('register-name').fill(customer.name);
    await page.getByTestId('register-submit').click();

    // ── 2. Referral card renders ───────────────────────────────────
    // Do NOT assert the code format — SPEC allows prefix + length to
    // change. Non-empty is the real contract: backend must issue a code.
    await expect(page.getByTestId('referral-code')).toHaveText(/\S+/);

    // Fresh customer: balance is exactly "0".
    await expect(page.getByTestId('points-balance')).toHaveText('0');

    // Empty referral list: <ul data-testid="referral-list"> with no <li>.
    await expect(
      page.getByTestId('referral-list').locator('li'),
    ).toHaveCount(0);

    // ── 3. Invite a referee ────────────────────────────────────────
    await page.getByTestId('referee-email').fill(referee.email);
    await page.getByTestId('referee-phone').fill(referee.phone);
    await page.getByTestId('referee-name').fill(referee.name);
    await page.getByTestId('referee-submit').click();

    // ── 4. Success state ───────────────────────────────────────────
    await expect(page.getByTestId('referee-success')).toBeVisible();
  });
});
