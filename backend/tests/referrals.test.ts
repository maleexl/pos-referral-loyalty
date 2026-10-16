/**
 * FILE: backend/tests/referrals.test.ts
 * PURPOSE: Integration tests for POST /api/referrals. Verifies the atomic
 *          create-referrer+referee flow, self-referral guard, conflict
 *          codes, expiry computation, and transaction rollback behavior.
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, backend/src/db/prisma.ts.
 *
 * PREREQUISITES: Postgres running + migrations applied + seed executed
 *                (referral_expiry_days required by the usecase).
 * Test isolation: emails prefixed `test-referral-`, phones in 09910xxxxx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { settings } from '../src/settings/loader.js';

const TEST_EMAIL_PREFIX = 'test-referral-';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function testEmail(suffix: string): string {
  return `${TEST_EMAIL_PREFIX}${suffix}@example.com`;
}
// WHY: dedicated phone range 09910xxxxx so cleanup and debugging do not
// collide with customers.test.ts (09900xxxxx) or seed data.
function testPhone(n: number): string {
  return `09910${String(n).padStart(5, '0')}`;
}

// WHY: helper for the common "create a referrer customer" step. Returns the
// referralCode the tests then use as input.referrerCode.
async function createReferrer(
  app: FastifyInstance,
  suffix: string,
  phoneN: number
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: {
      email: testEmail(suffix),
      phone: testPhone(phoneN),
      name: `Referrer ${suffix}`
    }
  });
  if (res.statusCode !== 201) {
    throw new Error(`setup: referrer create failed (${res.statusCode}): ${res.body}`);
  }
  return res.json().referralCode as string;
}

describe('POST /api/referrals', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    // WHY: settings loader caches for TTL; invalidate so we read the seeded
    // referral_expiry_days even if a prior test file warmed a stale map.
    settings.invalidateCache();
  });

  afterAll(async () => {
    // WHY: FK from referrals to customers has no ON DELETE CASCADE, so we
    // must delete referrals first or customer deletion will fail.
    const customers = await prisma.customer.findMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } },
      select: { id: true }
    });
    const ids = customers.map((c) => c.id);
    if (ids.length > 0) {
      await prisma.referral.deleteMany({
        where: {
          OR: [{ referrerId: { in: ids } }, { refereeId: { in: ids } }]
        }
      });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('happy path → 201 with API-CONTRACT shape', async () => {
    const referrerCode = await createReferrer(app, 'happy-referrer', 1);

    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode,
        refereeEmail: testEmail('happy-referee'),
        refereePhone: testPhone(2),
        refereeName: 'Bob Referee'
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('PENDING');
    expect(typeof body.referralId).toBe('string');
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.expiresAt).toBe('string');
    expect(body.referee).toMatchObject({
      id: expect.any(String),
      referralCode: expect.any(String)
    });
    // WHY: verify the referee got its own code following the name-prefix rule.
    expect(body.referee.referralCode).toMatch(/^BOB[A-Z0-9]{4,6}$/);
  });

  it('self-referral (same email) → 403 SELF_REFERRAL', async () => {
    const email = testEmail('self-email');
    const phone = testPhone(10);
    // Create the referrer with the specific email we will try to reuse.
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { email, phone, name: 'Self Email Referrer' }
    });
    // Fetch the code via lookup-by-email — easier than threading it back.
    const found = await prisma.customer.findUnique({ where: { email } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: found!.referralCode,
        refereeEmail: email, // same email
        refereePhone: testPhone(11),
        refereeName: 'Self'
      }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'SELF_REFERRAL' });
  });

  it('self-referral (same phone) → 403 SELF_REFERRAL', async () => {
    const email = testEmail('self-phone');
    const phone = testPhone(20);
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { email, phone, name: 'Self Phone Referrer' }
    });
    const found = await prisma.customer.findUnique({ where: { email } });

    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: found!.referralCode,
        refereeEmail: testEmail('self-phone-referee'),
        refereePhone: phone, // same phone
        refereeName: 'Self'
      }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'SELF_REFERRAL' });
  });

  it('referrer code not found → 404 REFERRER_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: 'ZZZZZZZZ',
        refereeEmail: testEmail('notfound-referee'),
        refereePhone: testPhone(30),
        refereeName: 'Nobody'
      }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'REFERRER_NOT_FOUND' });
  });

  it('referee email already exists → 409 REFEREE_EMAIL_EXISTS', async () => {
    const referrerCode = await createReferrer(app, 'dup-email-referrer', 40);
    // Preexisting customer whose email we will attempt to reuse as referee.
    const takenEmail = testEmail('dup-email-taken');
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: takenEmail,
        phone: testPhone(41),
        name: 'Preexisting'
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode,
        refereeEmail: takenEmail,
        refereePhone: testPhone(42),
        refereeName: 'New Referee'
      }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'REFEREE_EMAIL_EXISTS' });
  });

  it('referee phone already exists → 409 REFEREE_PHONE_EXISTS', async () => {
    const referrerCode = await createReferrer(app, 'dup-phone-referrer', 50);
    const takenPhone = testPhone(51);
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('dup-phone-taken'),
        phone: takenPhone,
        name: 'Preexisting'
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode,
        refereeEmail: testEmail('dup-phone-referee'),
        refereePhone: takenPhone,
        refereeName: 'New Referee'
      }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'REFEREE_PHONE_EXISTS' });
  });

  it('referee already has a referral → 409 REFEREE_HAS_REFERRER', async () => {
    // WHY: referees are new customers (SPEC F2). Once a customer is linked as
    // someone's referee they can never be one again (BR-2). This exercises the
    // documented code — previously the flow errored earlier with the generic
    // REFEREE_EMAIL_EXISTS and REFEREE_HAS_REFERRER was unreachable (AUD-006).
    const referrerA = await createReferrer(app, 'has-referrer-a', 80);
    const refereeEmail = testEmail('has-referrer-referee');
    const first = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrerA,
        refereeEmail,
        refereePhone: testPhone(81),
        refereeName: 'Once Referred'
      }
    });
    expect(first.statusCode).toBe(201);

    // A second referral for the same email — from a DIFFERENT referrer, so the
    // rejection can only come from the referee's existing referral.
    const referrerB = await createReferrer(app, 'has-referrer-b', 82);
    const second = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: referrerB,
        refereeEmail,
        refereePhone: testPhone(83),
        refereeName: 'Once Referred'
      }
    });

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'REFEREE_HAS_REFERRER' });
  });

  it('atomicity: self-referral failure leaves no orphan referee customer', async () => {
    // WHY: the self-referral guard runs BEFORE the referee is created, inside
    // the same transaction. If a future refactor moved the check AFTER the
    // create, a rollback would be required — this test verifies there is no
    // partial state: no customer with the attempted referee email exists.
    const email = testEmail('atomicity-referrer');
    const phone = testPhone(60);
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { email, phone, name: 'Atomicity Referrer' }
    });
    const found = await prisma.customer.findUnique({ where: { email } });

    const orphanEmail = testEmail('atomicity-orphan');
    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode: found!.referralCode,
        refereeEmail: email, // triggers SELF_REFERRAL
        refereePhone: phone,
        refereeName: 'Attempted Orphan'
      }
    });
    expect(res.statusCode).toBe(403);

    const orphan = await prisma.customer.findUnique({
      where: { email: orphanEmail }
    });
    expect(orphan).toBeNull();
  });

  it('expiresAt equals now + referral_expiry_days (±5s tolerance)', async () => {
    const expiryDays = await settings.getReferralExpiryDays();
    const referrerCode = await createReferrer(app, 'expiry-referrer', 70);

    const before = Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/api/referrals',
      payload: {
        referrerCode,
        refereeEmail: testEmail('expiry-referee'),
        refereePhone: testPhone(71),
        refereeName: 'Expiry Referee'
      }
    });
    const after = Date.now();

    expect(res.statusCode).toBe(201);
    const expiresAt = new Date(res.json().expiresAt).getTime();
    const expectedMin = before + expiryDays * MS_PER_DAY;
    const expectedMax = after + expiryDays * MS_PER_DAY;
    // WHY: ±5s tolerance absorbs processing time between our clock sample
    // and the usecase's Date.now() call inside the transaction.
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin - 5000);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax + 5000);
  });
});
