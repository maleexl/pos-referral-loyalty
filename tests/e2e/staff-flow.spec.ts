/**
 * FILE: tests/e2e/staff-flow.spec.ts
 * PURPOSE: E2E happy path for the Sprint 3 staff journey — enter the staff
 *          key on /staff, look up a customer by referral code, issue a
 *          points redemption, then confirm the returned redemption code.
 *          Seeds all required data through the public API (register +
 *          referral + POS visit) so the spec never depends on pre-existing
 *          DB rows; every run uses unique emails/phones.
 * CALLED BY: `npx playwright test` via tests/e2e/playwright.config.ts.
 * CALLS: @playwright/test (request fixture = seeding); frontend at baseURL
 *        (default :5173) which talks to backend at :3000 (both started
 *        externally — no webServer block in the config).
 * DEPS: frontend Staff page @ 55bc79b (testids per the project docs);
 *       backend F1/F2/F3 + /internal/mock-pos/visits on :3000.
 */

import { test, expect } from '@playwright/test';

// API base for seeding. The Playwright `request` fixture resolves relative
// URLs against the frontend baseURL, so seeding must use an absolute URL.
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
// Staff key lives in backend/.env (STAFF_API_KEY). Defaulted to the
// documented local dev value so the spec is runnable out of the box.
const STAFF_KEY = process.env.E2E_STAFF_KEY ?? 'change_me_staff';

test.describe('Staff flow — lookup, issue redemption, confirm', () => {
  // Unique per run so the suite is rerunnable against the same DB.
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const seed = parseInt(runId, 16);
  const phoneSuffix = (n: number) => String(n % 1_000_000_000).padStart(9, '0');
  const prefix = `t009-staff-${runId}`;

  const referrer = {
    email: `${prefix}-ref@example.com`,
    phone: `0${phoneSuffix(seed)}`,
    name: `E2E Staff Referrer ${runId}`,
  };
  const referee = {
    email: `${prefix}-referee@example.com`,
    phone: `0${phoneSuffix(seed + 1)}`,
    name: `E2E Staff Referee ${runId}`,
  };
  // A referral completed by a POS visit awards points_per_referral (default
  // 100) to the referrer. Redeem less than that so a second redemption of the
  // same amount could not fit — keeps the assertions deterministic.
  const POINTS_AWARDED = 100;
  const POINTS_TO_REDEEM = 40;
  const POINTS_REMAINING = POINTS_AWARDED - POINTS_TO_REDEEM;

  test.beforeEach(async ({ page }) => {
    // Clear localStorage before any app script runs — a stale staff key from
    // a prior test would skip the key prompt we intend to exercise.
    await page.addInitScript(() => window.localStorage.clear());
  });

  test('issues and confirms a redemption for a seeded customer', async ({
    page,
    request,
  }) => {
    // ── 0. Seed: register referrer → referral → completed POS visit ──
    const reg = await request.post(`${API_URL}/api/customers`, {
      data: referrer,
    });
    expect(reg.status(), 'seed register referrer').toBe(201);
    const referrerBody = await reg.json();
    const customerCode: string = referrerBody.referralCode;
    expect(customerCode, 'seed referral code').toBeTruthy();

    const referral = await request.post(`${API_URL}/api/referrals`, {
      data: {
        referrerCode: customerCode,
        refereeEmail: referee.email,
        refereePhone: referee.phone,
        refereeName: referee.name,
      },
    });
    expect(referral.status(), 'seed create referral').toBe(201);

    const visit = await request.post(`${API_URL}/internal/mock-pos/visits`, {
      data: { customerEmail: referee.email, amount: 500, note: 't009 staff e2e' },
    });
    expect(visit.status(), 'seed POS visit').toBe(200);
    const visitBody = await visit.json();
    expect(visitBody.referralCompleted, 'seed visit completes referral').toBe(true);

    // Prove the seeded balance is what the UI will display (contract F1/F3).
    const rewards = await request.get(
      `${API_URL}/api/customers/${customerCode}/rewards`,
    );
    expect(rewards.status()).toBe(200);
    expect((await rewards.json()).pointsBalance).toBe(POINTS_AWARDED);

    // ── 1. Staff key prompt ─────────────────────────────────────────
    await page.goto('/staff');
    await expect(page.getByTestId('staff-key-form')).toBeVisible();
    await page.getByTestId('staff-key-input').fill(STAFF_KEY);
    await page.getByTestId('staff-key-submit').click();

    // ── 2. Customer lookup ──────────────────────────────────────────
    await expect(page.getByTestId('staff-customer-form')).toBeVisible();
    await page.getByTestId('staff-customer-input').fill(customerCode);
    await page.getByTestId('staff-customer-submit').click();

    // Lookup resolves → RedemptionForm mounts once the customer is found.
    await expect(page.getByTestId('redeem-form')).toBeVisible();

    // ── 3. Issue a redemption ───────────────────────────────────────
    await page.getByTestId('redeem-points-input').fill(String(POINTS_TO_REDEEM));
    await page.getByTestId('redeem-submit').click();

    await expect(page.getByTestId('redemption-code')).toHaveText(/\S+/);
    await expect(page.getByTestId('redemption-remaining')).toHaveText(
      String(POINTS_REMAINING),
    );
    const redemptionCode = (
      await page.getByTestId('redemption-code').innerText()
    ).trim();

    // ── 4. Confirm the redemption ───────────────────────────────────
    // Assert the contract response (F3: status REDEEMED) AND the UI success
    // state. There is no documented testid for the confirm success message,
    // so the UI assertion targets the staff page's copy.
    const [confirmResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/staff/redeem/confirm') &&
          r.request().method() === 'POST',
      ),
      (async () => {
        await page.getByTestId('redeem-code-input').fill(redemptionCode);
        await page.getByTestId('redeem-confirm-submit').click();
      })(),
    ]);
    expect(confirmResponse.status(), 'confirm status').toBe(200);
    expect((await confirmResponse.json()).status).toBe('REDEEMED');
    await expect(page.getByText(/Confirmed at/i)).toBeVisible();
  });
});
