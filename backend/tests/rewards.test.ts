/**
 * FILE: backend/tests/rewards.test.ts
 * PURPOSE: Integration tests for F3 — reward listing (public) and staff
 *          redemption (issue + confirm). Verifies signed ledger semantics,
 *          staff-key auth, insufficient-points guard, code idempotency, and
 *          expiry handling.
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, backend/src/db/prisma.ts, backend/src/constants.ts.
 *
 * PREREQUISITES: Postgres running + migrations + seed. STAFF_API_KEY is read
 *                from the environment (Vite auto-loads backend/.env for tests).
 * Test isolation: emails prefixed `test-rewards-`, phones in 09930xxxxx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Reward } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { REWARD_STATUS } from '../src/constants.js';

const TEST_EMAIL_PREFIX = 'test-rewards-';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// WHY: read once — the same value flows into staff route auth via
// buildApp() → staffRoutes → readStaffKey(). If it is missing, tests fail
// loudly in beforeAll instead of silently passing a wrong-key check.
const STAFF_KEY = process.env.STAFF_API_KEY;

function testEmail(suffix: string): string {
  return `${TEST_EMAIL_PREFIX}${suffix}@example.com`;
}
function testPhone(n: number): string {
  return `09930${String(n).padStart(5, '0')}`;
}
function staffHeaders(): Record<string, string> {
  if (!STAFF_KEY) throw new Error('STAFF_API_KEY not set — check backend/.env');
  return { 'x-staff-key': STAFF_KEY };
}

interface ApiCustomer {
  id: string;
  referralCode: string;
  email: string;
}

async function createCustomerViaApi(
  app: FastifyInstance,
  suffix: string,
  phoneN: number,
  name: string
): Promise<ApiCustomer> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: { email: testEmail(suffix), phone: testPhone(phoneN), name }
  });
  if (res.statusCode !== 201) {
    throw new Error(`setup: customer create failed (${res.statusCode}): ${res.body}`);
  }
  return res.json() as ApiCustomer;
}

// WHY: seed rewards directly via Prisma instead of going through the full
// F2a/F2b referral flow. F2a/F2b have their own test suites; here we only
// care about F3's read + redeem behavior, so direct seeding keeps each test
// short and its failure surface narrow.
async function seedReward(
  customerId: string,
  opts: {
    type: 'REFERRAL_BONUS' | 'REDEMPTION';
    points: number;
    status?: 'ISSUED' | 'REDEEMED' | 'EXPIRED';
    redemptionCode?: string;
    expiresAt?: Date;
  }
): Promise<Reward> {
  return prisma.reward.create({
    data: {
      customerId,
      type: opts.type,
      points: opts.points,
      status: opts.status ?? REWARD_STATUS.ISSUED,
      redemptionCode: opts.redemptionCode ?? null,
      expiresAt: opts.expiresAt ?? null
    }
  });
}

describe('F3 — rewards list + redemption', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (!STAFF_KEY) {
      throw new Error('STAFF_API_KEY must be set for rewards tests');
    }
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // WHY: delete in FK order — reward references customer; posVisit +
    // referral also reference customer.
    const customers = await prisma.customer.findMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      select: { id: true }
    });
    const ids = customers.map((c) => c.id);
    if (ids.length > 0) {
      await prisma.reward.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.referral.deleteMany({
        where: { OR: [{ referrerId: { in: ids } }, { refereeId: { in: ids } }] }
      });
      await prisma.posVisit.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // GET /api/customers/:referralCode/rewards
  // ---------------------------------------------------------------------

  it('GET rewards — no rewards → { pointsBalance: 0, rewards: [] }', async () => {
    const customer = await createCustomerViaApi(app, 'empty', 1, 'Empty Customer');

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customer.referralCode}/rewards`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pointsBalance).toBe(0);
    expect(body.rewards).toEqual([]);
  });

  it('GET rewards — with bonus → balance reflects SUM(points)', async () => {
    const customer = await createCustomerViaApi(app, 'with-bonus', 2, 'With Bonus');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 100 });
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 50 });

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customer.referralCode}/rewards`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pointsBalance).toBe(150);
    expect(body.rewards).toHaveLength(2);
    // WHY: shape check on one row — API consumers rely on these keys.
    expect(body.rewards[0]).toMatchObject({
      type: 'REFERRAL_BONUS',
      status: 'ISSUED'
    });
  });

  it('GET rewards — EXPIRED reward excluded from balance', async () => {
    const customer = await createCustomerViaApi(app, 'with-expired', 3, 'With Expired');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 100 });
    // WHY: an EXPIRED reward (e.g. a lapsed redemption that was refunded or
    // a bonus that was voided) must NOT contribute to the balance. The API
    // returns the row itself (so the frontend can display history) but the
    // aggregate filters it out.
    await seedReward(customer.id, {
      type: 'REFERRAL_BONUS',
      points: 999,
      status: REWARD_STATUS.EXPIRED
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customer.referralCode}/rewards`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pointsBalance).toBe(100);
    expect(body.rewards).toHaveLength(2);
  });

  it('GET rewards — unknown referral code → 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/ZZZZZZZZ/rewards'
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  // ---------------------------------------------------------------------
  // POST /staff/redeem
  // ---------------------------------------------------------------------

  it('POST /staff/redeem — happy path → 200 + correct remaining balance', async () => {
    const customer = await createCustomerViaApi(app, 'redeem-happy', 4, 'Redeem Happy');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 100 });

    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem',
      headers: staffHeaders(),
      payload: { customerCode: customer.referralCode, points: 60 }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pointsUsed).toBe(60);
    expect(body.pointsRemaining).toBe(40);
    // WHY: code length from settings (reward_code_length = 8).
    expect(typeof body.redemptionCode).toBe('string');
    expect(body.redemptionCode).toHaveLength(8);
    // WHY: charset excludes 0/O/1/I — assert no look-alike chars leak in.
    expect(body.redemptionCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    expect(typeof body.expiresAt).toBe('string');

    // DB: reward row exists with negative points, correct status/type.
    const reward = await prisma.reward.findUnique({
      where: { redemptionCode: body.redemptionCode }
    });
    expect(reward).not.toBeNull();
    expect(reward).toMatchObject({
      type: 'REDEMPTION',
      points: -60,
      status: 'ISSUED',
      customerId: customer.id
    });
  });

  it('POST /staff/redeem — insufficient points → 400 INSUFFICIENT_POINTS', async () => {
    const customer = await createCustomerViaApi(app, 'redeem-low', 5, 'Redeem Low');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 30 });

    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem',
      headers: staffHeaders(),
      payload: { customerCode: customer.referralCode, points: 100 }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INSUFFICIENT_POINTS' });
  });

  it('POST /staff/redeem — wrong staff key → 401 UNAUTHORIZED', async () => {
    const customer = await createCustomerViaApi(app, 'redeem-badkey', 6, 'Redeem BadKey');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 100 });

    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem',
      headers: { 'x-staff-key': 'definitely-not-the-key' },
      payload: { customerCode: customer.referralCode, points: 10 }
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('POST /staff/redeem — unknown customer → 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem',
      headers: staffHeaders(),
      payload: { customerCode: 'ZZZZZZZZ', points: 10 }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  // ---------------------------------------------------------------------
  // POST /staff/redeem/confirm
  // ---------------------------------------------------------------------

  // Helper: end-to-end issue → returns the redemptionCode for the confirm
  // tests. Not exported at module scope because only this describe uses it.
  async function issueRedeem(
    suffix: string,
    phoneN: number,
    points: number
  ): Promise<{ customer: ApiCustomer; code: string }> {
    const customer = await createCustomerViaApi(app, suffix, phoneN, `Redeem ${suffix}`);
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: points * 2 });
    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem',
      headers: staffHeaders(),
      payload: { customerCode: customer.referralCode, points }
    });
    if (res.statusCode !== 200) {
      throw new Error(`setup: redeem failed (${res.statusCode}): ${res.body}`);
    }
    return { customer, code: res.json().redemptionCode as string };
  }

  it('POST /staff/redeem/confirm — happy path → 200 REDEEMED', async () => {
    const { code } = await issueRedeem('confirm-happy', 10, 40);

    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem/confirm',
      headers: staffHeaders(),
      payload: { redemptionCode: code }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('REDEEMED');
    expect(typeof body.redeemedAt).toBe('string');

    const reward = await prisma.reward.findUnique({ where: { redemptionCode: code } });
    expect(reward?.status).toBe('REDEEMED');
    expect(reward?.redeemedAt).not.toBeNull();
  });

  it('POST /staff/redeem/confirm — already redeemed → 409 CODE_ALREADY_REDEEMED', async () => {
    const { code } = await issueRedeem('confirm-dup', 11, 20);

    // First confirm succeeds.
    const first = await app.inject({
      method: 'POST',
      url: '/staff/redeem/confirm',
      headers: staffHeaders(),
      payload: { redemptionCode: code }
    });
    expect(first.statusCode).toBe(200);

    // Second confirm → 409.
    const second = await app.inject({
      method: 'POST',
      url: '/staff/redeem/confirm',
      headers: staffHeaders(),
      payload: { redemptionCode: code }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'CODE_ALREADY_REDEEMED' });
  });

  it('POST /staff/redeem/confirm — expired code → 410 CODE_EXPIRED', async () => {
    const customer = await createCustomerViaApi(app, 'confirm-exp', 12, 'Confirm Exp');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 100 });
    // Seed a redemption directly with an already-past expiry — we cannot get
    // the API to hand us an expired code without waiting.
    const expiredAt = new Date(Date.now() - MS_PER_DAY);
    await seedReward(customer.id, {
      type: 'REDEMPTION',
      points: -30,
      redemptionCode: 'EXPIRED1',
      expiresAt: expiredAt
    });

    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem/confirm',
      headers: staffHeaders(),
      payload: { redemptionCode: 'EXPIRED1' }
    });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ code: 'CODE_EXPIRED' });

    // Lazy flip: the usecase should have marked it EXPIRED.
    const reward = await prisma.reward.findUnique({
      where: { redemptionCode: 'EXPIRED1' }
    });
    expect(reward?.status).toBe('EXPIRED');
  });

  it('POST /staff/redeem/confirm — unknown code → 404 CODE_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/staff/redeem/confirm',
      headers: staffHeaders(),
      payload: { redemptionCode: 'NEVERMINT' }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'CODE_NOT_FOUND' });
  });

  it('balance after redemption = original - redeemed', async () => {
    const customer = await createCustomerViaApi(app, 'balance-final', 13, 'Balance Final');
    await seedReward(customer.id, { type: 'REFERRAL_BONUS', points: 100 });

    const redeem = await app.inject({
      method: 'POST',
      url: '/staff/redeem',
      headers: staffHeaders(),
      payload: { customerCode: customer.referralCode, points: 30 }
    });
    expect(redeem.statusCode).toBe(200);
    const code = redeem.json().redemptionCode as string;

    // Before confirm: balance reflects the reserved (negative) entry.
    const afterIssue = await app.inject({
      method: 'GET',
      url: `/api/customers/${customer.referralCode}/rewards`
    });
    expect(afterIssue.json().pointsBalance).toBe(70);

    // Confirm — balance must not change; the ledger entry already moved.
    const confirm = await app.inject({
      method: 'POST',
      url: '/staff/redeem/confirm',
      headers: staffHeaders(),
      payload: { redemptionCode: code }
    });
    expect(confirm.statusCode).toBe(200);

    const afterConfirm = await app.inject({
      method: 'GET',
      url: `/api/customers/${customer.referralCode}/rewards`
    });
    expect(afterConfirm.json().pointsBalance).toBe(70);
  });
});
