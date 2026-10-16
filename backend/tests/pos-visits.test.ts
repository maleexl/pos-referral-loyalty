/**
 * FILE: backend/tests/pos-visits.test.ts
 * PURPOSE: Integration tests for POST /internal/mock-pos/visits. Verifies the
 *          full referral-completion flow: no-referral path, PENDING → COMPLETED
 *          with reward creation, COMPLETED idempotency, EXPIRED path,
 *          customer-not-found, atomic rollback, balance formula (BR-3/5), and
 *          the concurrent-completion race (exactly one winner — AUD-010).
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, backend/src/db/prisma.ts, backend/src/settings/loader.ts.
 *
 * PREREQUISITES: Postgres running + migrations + seed (referral_expiry_days
 *                and points_per_referral required by the usecase).
 * Test isolation: emails prefixed `test-posvisits-`, phones in 09920xxxxx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { settings } from '../src/settings/loader.js';

const TEST_EMAIL_PREFIX = 'test-posvisits-';

function testEmail(suffix: string): string {
  return `${TEST_EMAIL_PREFIX}${suffix}@example.com`;
}
function testPhone(n: number): string {
  return `09920${String(n).padStart(5, '0')}`;
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

async function postVisit(
  app: FastifyInstance,
  email: string,
  amount = 100
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/internal/mock-pos/visits',
    payload: { customerEmail: email, amount }
  });
  return { status: res.statusCode, body: res.json() };
}

describe('POST /internal/mock-pos/visits', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    settings.invalidateCache();
  });

  afterAll(async () => {
    // WHY: delete in FK order — reward references referral AND customer;
    // referral references customer; posVisit references customer.
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

  it('customer with no referral → 200 { referralCompleted: false }', async () => {
    await createCustomerViaApi(app, 'no-referral', 1, 'Lonely Customer');

    const { status, body } = await postVisit(app, testEmail('no-referral'), 50);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      referralCompleted: false,
      pointsAwarded: 0,
      referrerCode: null
    });
    expect(typeof body.visitId).toBe('string');
    expect(typeof body.visitedAt).toBe('string');
  });

  it('PENDING referral → 200 { referralCompleted: true } + reward row', async () => {
    const referrer = await createCustomerViaApi(app, 'pending-referrer', 2, 'Referrer');
    // Create referee + PENDING referral in one call.
    const refRes = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrer.referralCode,
        refereeEmail: testEmail('pending-referee'),
        refereePhone: testPhone(3),
        refereeName: 'Referee'
      }
    });
    expect(refRes.statusCode).toBe(201);
    const referralId = refRes.json().referralId as string;

    const expectedPoints = await settings.getPointsPerReferral();
    const { status, body } = await postVisit(app, testEmail('pending-referee'), 200);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      referralCompleted: true,
      pointsAwarded: expectedPoints,
      referrerCode: referrer.referralCode
    });

    // --- DB assertions ---
    const referralAfter = await prisma.referral.findUnique({
      where: { id: referralId }
    });
    expect(referralAfter?.status).toBe('COMPLETED');
    expect(referralAfter?.completedAt).not.toBeNull();

    const rewards = await prisma.reward.findMany({
      where: { referralId },
      select: { type: true, points: true, status: true, customerId: true }
    });
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({
      type: 'REFERRAL_BONUS',
      points: expectedPoints,
      status: 'ISSUED',
      customerId: referrer.id
    });
  });

  it('COMPLETED referral (idempotency) → 409 + no second reward', async () => {
    const referrer = await createCustomerViaApi(app, 'idemp-referrer', 4, 'Idemp Referrer');
    const refRes = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrer.referralCode,
        refereeEmail: testEmail('idemp-referee'),
        refereePhone: testPhone(5),
        refereeName: 'Idemp Referee'
      }
    });
    const referralId = refRes.json().referralId as string;

    // First visit → completes.
    const first = await postVisit(app, testEmail('idemp-referee'), 100);
    expect(first.status).toBe(200);
    expect(first.body.referralCompleted).toBe(true);

    // Second visit → 409, visit STILL recorded (see 409 body visitId).
    const second = await postVisit(app, testEmail('idemp-referee'), 100);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      code: 'REFERRAL_ALREADY_COMPLETED',
      referralCompleted: false,
      pointsAwarded: 0
    });
    // WHY: 409 body must carry visitId so the client knows the visit landed.
    expect(typeof second.body.visitId).toBe('string');

    // Still exactly one reward — no double credit.
    const rewardCount = await prisma.reward.count({ where: { referralId } });
    expect(rewardCount).toBe(1);

    // Both visits recorded.
    const visitCount = await prisma.posVisit.count({
      where: { customer: { email: testEmail('idemp-referee') } }
    });
    expect(visitCount).toBe(2);
  });

  it('EXPIRED referral → 410 + status flipped from PENDING to EXPIRED', async () => {
    const referrer = await createCustomerViaApi(app, 'exp-referrer', 6, 'Exp Referrer');
    const refRes = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrer.referralCode,
        refereeEmail: testEmail('exp-referee'),
        refereePhone: testPhone(7),
        refereeName: 'Exp Referee'
      }
    });
    const referralId = refRes.json().referralId as string;

    // WHY: force the deadline into the past. API always sets a future
    // expiresAt from settings, so we bypass it via a direct DB update.
    await prisma.referral.update({
      where: { id: referralId },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const { status, body } = await postVisit(app, testEmail('exp-referee'), 100);
    expect(status).toBe(410);
    expect(body).toMatchObject({
      code: 'REFERRAL_EXPIRED',
      referralCompleted: false,
      pointsAwarded: 0
    });

    // The usecase lazily flips PENDING → EXPIRED when it observes the lapse.
    const after = await prisma.referral.findUnique({ where: { id: referralId } });
    expect(after?.status).toBe('EXPIRED');

    // No reward should have been issued.
    const rewardCount = await prisma.reward.count({ where: { referralId } });
    expect(rewardCount).toBe(0);
  });

  it('customer not found → 404 CUSTOMER_NOT_FOUND', async () => {
    const { status, body } = await postVisit(app, testEmail('ghost'), 100);
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('atomicity: reward failure rolls back the referral update', async () => {
    const referrer = await createCustomerViaApi(app, 'atomic-referrer', 8, 'Atomic Referrer');
    const refRes = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrer.referralCode,
        refereeEmail: testEmail('atomic-referee'),
        refereePhone: testPhone(9),
        refereeName: 'Atomic Referee'
      }
    });
    const referralId = refRes.json().referralId as string;

    // WHY: pre-seed a reward with the same (referralId, type) pair so the
    // second create() inside TX2 hits UNIQUE(referralId, type). This forces
    // the transaction to fail AFTER updateMany has already run, letting us
    // verify the optimistic-lock update is rolled back together with it.
    await prisma.reward.create({
      data: {
        customerId: referrer.id,
        referralId,
        type: 'REFERRAL_BONUS',
        points: 999,
        status: 'ISSUED'
      }
    });

    const { status, body } = await postVisit(app, testEmail('atomic-referee'), 100);
    // Why 409: the P2002 catch on (referralId, type) translates the DB
    // invariant into the same REFERRAL_ALREADY_COMPLETED response.
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'REFERRAL_ALREADY_COMPLETED' });

    // Rolled back: referral still PENDING, only the pre-seeded reward exists.
    const after = await prisma.referral.findUnique({ where: { id: referralId } });
    expect(after?.status).toBe('PENDING');
    expect(after?.completedAt).toBeNull();

    const rewardCount = await prisma.reward.count({ where: { referralId } });
    expect(rewardCount).toBe(1);
  });

  it('balance formula: SUM(rewards.points) == points_per_referral after completion', async () => {
    const referrer = await createCustomerViaApi(app, 'balance-referrer', 10, 'Balance Referrer');
    const refRes = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrer.referralCode,
        refereeEmail: testEmail('balance-referee'),
        refereePhone: testPhone(11),
        refereeName: 'Balance Referee'
      }
    });
    expect(refRes.statusCode).toBe(201);

    const expectedPoints = await settings.getPointsPerReferral();
    const { status } = await postVisit(app, testEmail('balance-referee'), 100);
    expect(status).toBe(200);

    // Balance is derived, not stored — verify the ledger sums correctly.
    const agg = await prisma.reward.aggregate({
      where: { customerId: referrer.id },
      _sum: { points: true }
    });
    expect(agg._sum.points).toBe(expectedPoints);
  });

  // WHY: `Promise.all(inject, inject)` starts both requests before either
  // awaits its first DB roundtrip, so their transactions overlap on the same
  // referral. The optimistic lock (updateMany WHERE status=PENDING) plus the
  // UNIQUE(referralId, type) reward constraint must let exactly one win; the
  // loser gets the documented 409 REFERRAL_ALREADY_COMPLETED (AUD-010).
  it('race: two parallel visits → exactly one completion', async () => {
    const referrer = await createCustomerViaApi(app, 'race-referrer', 12, 'Race Referrer');
    const refRes = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrer.referralCode,
        refereeEmail: testEmail('race-referee'),
        refereePhone: testPhone(13),
        refereeName: 'Race Referee'
      }
    });
    expect(refRes.statusCode).toBe(201);
    const referralId = refRes.json().referralId as string;
    const expectedPoints = await settings.getPointsPerReferral();

    const [a, b] = await Promise.all([
      postVisit(app, testEmail('race-referee'), 100),
      postVisit(app, testEmail('race-referee'), 100)
    ]);

    // Exactly one success (200) and one documented conflict (409).
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(winner.body).toMatchObject({
      referralCompleted: true,
      pointsAwarded: expectedPoints,
      referrerCode: referrer.referralCode
    });
    expect(loser.body).toMatchObject({
      code: 'REFERRAL_ALREADY_COMPLETED',
      referralCompleted: false,
      pointsAwarded: 0
    });

    // Points awarded exactly once: one ledger row, balance == points_per_referral.
    const rewards = await prisma.reward.findMany({ where: { referralId } });
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({
      type: 'REFERRAL_BONUS',
      points: expectedPoints,
      customerId: referrer.id
    });
    const agg = await prisma.reward.aggregate({
      where: { customerId: referrer.id },
      _sum: { points: true }
    });
    expect(agg._sum.points).toBe(expectedPoints);

    // Both visits still recorded — the visit write precedes completion (F2b).
    const visitCount = await prisma.posVisit.count({
      where: { customer: { email: testEmail('race-referee') } }
    });
    expect(visitCount).toBe(2);

    const after = await prisma.referral.findUnique({ where: { id: referralId } });
    expect(after?.status).toBe('COMPLETED');
  });
});
