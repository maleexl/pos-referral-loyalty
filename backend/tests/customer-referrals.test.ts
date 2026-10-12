/**
 * FILE: backend/tests/customer-referrals.test.ts
 * PURPOSE: Integration tests for GET /api/customers/:referralCode/referrals —
 *          the customer-facing view of their own referral list. Verifies
 *          public read semantics, empty/pending/completed states, and the
 *          404 path for an unknown code.
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, backend/src/db/prisma.ts.
 *
 * PREREQUISITES: Postgres running + migrations applied.
 * Test isolation: emails prefixed `test-cust-ref-`, phones in 09950xxxxx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

const TEST_EMAIL_PREFIX = 'test-cust-ref-';

function testEmail(suffix: string): string {
  return `${TEST_EMAIL_PREFIX}${suffix}@example.com`;
}
function testPhone(n: number): string {
  return `09950${String(n).padStart(5, '0')}`;
}

interface ApiCustomer {
  id: string;
  referralCode: string;
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

async function createReferralViaApi(
  app: FastifyInstance,
  referrerCode: string,
  refereeSuffix: string,
  phoneN: number,
  refereeName: string
): Promise<{ referralId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/referrals',
    payload: {
      referrerCode,
      refereeEmail: testEmail(refereeSuffix),
      refereePhone: testPhone(phoneN),
      refereeName
    }
  });
  if (res.statusCode !== 201) {
    throw new Error(`setup: referral create failed (${res.statusCode}): ${res.body}`);
  }
  return res.json() as { referralId: string };
}

describe('GET /api/customers/:referralCode/referrals', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // WHY: FK order — reward → referral → posVisit → customer. Referrals
    // reference customers via referrerId AND refereeId, so both sides of our
    // test data must be dropped before the customer rows themselves.
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

  it('customer with no referrals → 200 { items: [] }', async () => {
    const c = await createCustomerViaApi(app, 'empty', 1, 'Empty Referrer');

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${c.referralCode}/referrals`
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('customer with PENDING referral → 200 with status=PENDING', async () => {
    const ref = await createCustomerViaApi(app, 'pend-ref', 2, 'Pending Referrer');
    await createReferralViaApi(app, ref.referralCode, 'pend-friend', 3, 'Pending Friend');

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${ref.referralCode}/referrals`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.status).toBe('PENDING');
    expect(item.completedAt).toBeNull();
    expect(typeof item.createdAt).toBe('string');
    // Shape check: referee nested, no referrer fields (owner knows their own).
    expect(item.referee).toMatchObject({
      id: expect.any(String),
      name: 'Pending Friend',
      referralCode: expect.any(String)
    });
    expect(item.referrer).toBeUndefined();
  });

  it('customer with COMPLETED referral → 200 with completedAt set', async () => {
    const ref = await createCustomerViaApi(app, 'comp-ref', 4, 'Completed Referrer');
    const created = await createReferralViaApi(
      app,
      ref.referralCode,
      'comp-friend',
      5,
      'Completed Friend'
    );

    // WHY: flip the referral to COMPLETED via direct Prisma. Going through
    // the full F2b path (POS visit) would drag that suite's setup into this
    // one; the endpoint we are testing does not care *how* a row became
    // COMPLETED, only that the status is surfaced correctly.
    await prisma.referral.update({
      where: { id: created.referralId },
      data: { status: 'COMPLETED', completedAt: new Date() }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${ref.referralCode}/referrals`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe('COMPLETED');
    expect(typeof body.items[0].completedAt).toBe('string');
  });

  it('unknown referralCode → 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/ZZZZZZZZ/referrals'
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
