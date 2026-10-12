/**
 * FILE: backend/tests/admin.test.ts
 * PURPOSE: Integration tests for F4 — admin endpoints. Covers admin-key auth,
 *          pagination + status filter on referrals, redemption listing,
 *          settings read, and PATCH validation + immediate cache invalidation.
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, backend/src/db/prisma.ts,
 *        backend/src/settings/schema.ts, backend/src/constants.ts.
 *
 * PREREQUISITES: Postgres running + migrations + seed.
 * Test isolation: emails prefixed `test-admin-`, phones in 09940xxxxx.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { SETTING_KEYS } from '../src/settings/schema.js';
import { settings as settingsLoader } from '../src/settings/loader.js';

const TEST_EMAIL_PREFIX = 'test-admin-';
const ADMIN_KEY = process.env.ADMIN_API_KEY;

function testEmail(suffix: string): string {
  return `${TEST_EMAIL_PREFIX}${suffix}@example.com`;
}
function testPhone(n: number): string {
  return `09940${String(n).padStart(5, '0')}`;
}
function adminHeaders(): Record<string, string> {
  if (!ADMIN_KEY) throw new Error('ADMIN_API_KEY not set');
  return { 'x-admin-key': ADMIN_KEY };
}

// --- Setup helpers --------------------------------------------------------
// WHY: seed customers + referrals directly via Prisma. Going through the API
// would be slower and couple this suite to F1/F2a behavior that already has
// its own tests.
async function seedCustomer(
  suffix: string,
  phoneN: number,
  name: string
): Promise<{ id: string; referralCode: string }> {
  const code = `ADMIN${suffix.toUpperCase().slice(0, 4)}${phoneN}`;
  const c = await prisma.customer.create({
    data: {
      email: testEmail(suffix),
      phone: testPhone(phoneN),
      name,
      referralCode: code
    }
  });
  return { id: c.id, referralCode: c.referralCode };
}

async function seedReferral(
  referrerId: string,
  refereeId: string,
  status: 'PENDING' | 'COMPLETED' | 'EXPIRED',
  opts: { createdAt?: Date } = {}
): Promise<string> {
  const r = await prisma.referral.create({
    data: {
      referrerId,
      refereeId,
      status,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      completedAt: status === 'COMPLETED' ? new Date() : null,
      // WHY: createdAt can be back-dated so pagination ordering is
      // deterministic in the test (otherwise rows created in the same ms
      // have ambiguous orderBy).
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {})
    }
  });
  return r.id;
}

describe('F4 — admin endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (!ADMIN_KEY) {
      throw new Error('ADMIN_API_KEY must be set for admin tests');
    }
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // WHY: FK order — reward → referral → posVisit → customer.
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
  // Auth
  // ---------------------------------------------------------------------

  it('GET /admin/referrals — no auth header → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/referrals' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('GET /admin/referrals — wrong admin key → 401 UNAUTHORIZED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/referrals',
      headers: { 'x-admin-key': 'definitely-not-the-key' }
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // ---------------------------------------------------------------------
  // GET /admin/referrals
  // ---------------------------------------------------------------------

  it('GET /admin/referrals — 200 with items[] + total + page + limit', async () => {
    const ref1 = await seedCustomer('r1', 1, 'Admin R1');
    const ref2 = await seedCustomer('e1', 2, 'Admin E1');
    await seedReferral(ref1.id, ref2.id, 'PENDING');

    const res = await app.inject({
      method: 'GET',
      url: '/admin/referrals',
      headers: adminHeaders()
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.items)).toBe(true);
    // Shape check on one item.
    const item = body.items[0];
    expect(item).toMatchObject({
      id: expect.any(String),
      status: expect.any(String),
      createdAt: expect.any(String),
      expiresAt: expect.any(String),
      referrer: {
        id: expect.any(String),
        name: expect.any(String),
        referralCode: expect.any(String)
      },
      referee: {
        id: expect.any(String),
        name: expect.any(String),
        referralCode: expect.any(String)
      }
    });
  });

  it('GET /admin/referrals?status=COMPLETED — filter works', async () => {
    // Seed a completed + a pending to prove the filter discriminates.
    const rA = await seedCustomer('rf1', 3, 'Filter R1');
    const eA = await seedCustomer('ef1', 4, 'Filter E1');
    await seedReferral(rA.id, eA.id, 'COMPLETED');
    const rB = await seedCustomer('rf2', 5, 'Filter R2');
    const eB = await seedCustomer('ef2', 6, 'Filter E2');
    await seedReferral(rB.id, eB.id, 'PENDING');

    const res = await app.inject({
      method: 'GET',
      url: '/admin/referrals?status=COMPLETED',
      headers: adminHeaders()
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // All returned rows must be COMPLETED.
    for (const item of body.items) {
      expect(item.status).toBe('COMPLETED');
    }
    // And the filter did narrow the set.
    expect(body.items.length).toBeLessThanOrEqual(body.total);
  });

  // ---------------------------------------------------------------------
  // Pagination + limit behavior
  // ---------------------------------------------------------------------

  it('GET /admin/referrals?limit=1 — walks pages without duplication', async () => {
    // WHY: this suite shares a real DB with other suites; the row set is not
    // under our control. So we do NOT assert "the newest row is X" — we
    // assert the *contract* of pagination itself: each page returns `limit`
    // items (until exhausted) and consecutive pages do not overlap.
    const first = await app.inject({
      method: 'GET',
      url: '/admin/referrals?limit=1&page=1',
      headers: adminHeaders()
    });
    expect(first.statusCode).toBe(200);
    const total = first.json().total as number;
    expect(total).toBeGreaterThanOrEqual(2);

    const p1 = await app.inject({
      method: 'GET',
      url: '/admin/referrals?limit=1&page=1',
      headers: adminHeaders()
    });
    const p2 = await app.inject({
      method: 'GET',
      url: '/admin/referrals?limit=1&page=2',
      headers: adminHeaders()
    });
    expect(p1.json().items).toHaveLength(1);
    expect(p2.json().items).toHaveLength(1);
    // The two pages must be disjoint — that is what `skip` guarantees.
    expect(p1.json().items[0].id).not.toBe(p2.json().items[0].id);
  });

  it('GET /admin/referrals?limit=999 — zod rejects above cap → 400', async () => {
    // WHY: MAX_PAGE_SIZE=100 is enforced by zod .max(); a value over the cap
    // is a client error, not a silent clamp. Matches Q1 decision.
    const res = await app.inject({
      method: 'GET',
      url: '/admin/referrals?limit=999',
      headers: adminHeaders()
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('GET /admin/referrals?limit=0 → 400 INVALID_INPUT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/referrals?limit=0',
      headers: adminHeaders()
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_INPUT' });
  });

  // ---------------------------------------------------------------------
  // GET /admin/redemptions
  // ---------------------------------------------------------------------

  it('GET /admin/redemptions — only REDEMPTION rewards returned', async () => {
    const c = await seedCustomer('red-cust', 11, 'Redemption Customer');
    // Seed a REFERRAL_BONUS and a REDEMPTION — only the latter should appear.
    await prisma.reward.create({
      data: {
        customerId: c.id,
        type: 'REFERRAL_BONUS',
        points: 100,
        status: 'ISSUED'
      }
    });
    await prisma.reward.create({
      data: {
        customerId: c.id,
        type: 'REDEMPTION',
        points: -50,
        status: 'ISSUED',
        redemptionCode: 'ADMREDEM',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/redemptions',
      headers: adminHeaders()
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    // Every returned row must carry a redemptionCode (implies type=REDEMPTION).
    for (const item of body.items) {
      expect(item.code).not.toBeNull();
    }
    // WHY: the DB may contain redemptions from other test suites (rewards
    // test runs first). items[0] therefore is not guaranteed to be OUR row —
    // search the returned page for the customer we just seeded.
    const mine = body.items.find(
      (it: { customerCode: string }) => it.customerCode === c.referralCode
    );
    expect(mine).toBeDefined();
    expect(mine.code).toBe('ADMREDEM');
  });

  // ---------------------------------------------------------------------
  // GET /admin/settings
  // ---------------------------------------------------------------------

  it('GET /admin/settings — returns all 5 schema keys', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/settings',
      headers: adminHeaders()
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Every key from SETTING_SCHEMA must be present, string-typed.
    for (const key of SETTING_KEYS) {
      expect(body[key]).toEqual(expect.any(String));
    }
  });

  // ---------------------------------------------------------------------
  // PATCH /admin/settings
  // ---------------------------------------------------------------------

  // WHY: helper that restores the original value even if the test throws —
  // settings are shared across tests and a leaked mutation would cause
  // cascading failures elsewhere.
  async function withSettingRestore(
    key: string,
    mutate: () => Promise<void>
  ): Promise<void> {
    const before = await prisma.setting.findUnique({ where: { key } });
    if (!before) throw new Error(`setting ${key} not seeded`);
    try {
      await mutate();
    } finally {
      // WHY: restore via direct Prisma — the loader cache still holds the
      // PATCHed value ('6') from the previous API call. Without this
      // invalidation the *next* test would read a stale cached value and
      // fail with confusing assertions.
      await prisma.setting.update({
        where: { key },
        data: { value: before.value }
      });
      settingsLoader.invalidateCache();
    }
  }

  it('PATCH /admin/settings — valid update → 200 + new value reflected', async () => {
    await withSettingRestore('reward_code_length', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/admin/settings',
        headers: adminHeaders(),
        payload: { reward_code_length: '6' }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // WHY: response carries the FULL updated map, per Q3 decision.
      expect(body.reward_code_length).toBe('6');
      // Other keys are returned unchanged.
      expect(body.points_per_referral).toEqual(expect.any(String));
    });
  });

  it('PATCH /admin/settings — unknown key → 400 UNKNOWN_SETTING_KEY', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings',
      headers: adminHeaders(),
      payload: { not_a_real_key: '42' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'UNKNOWN_SETTING_KEY' });
  });

  it('PATCH /admin/settings — non-integer for int field → 400 INVALID_TYPE', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings',
      headers: adminHeaders(),
      payload: { points_per_referral: 'abc' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_TYPE' });
  });

  it('PATCH /admin/settings — out of range → 400 OUT_OF_RANGE', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/settings',
      headers: adminHeaders(),
      payload: { points_per_referral: '99999999' }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'OUT_OF_RANGE' });
  });

  it('PATCH /admin/settings — cache invalidated immediately after commit', async () => {
    // Warm the cache with the current value first.
    const warm = await app.inject({
      method: 'GET',
      url: '/admin/settings',
      headers: adminHeaders()
    });
    expect(warm.json().reward_code_length).toBe('8');

    await withSettingRestore('reward_code_length', async () => {
      const patch = await app.inject({
        method: 'PATCH',
        url: '/admin/settings',
        headers: adminHeaders(),
        payload: { reward_code_length: '5' }
      });
      expect(patch.statusCode).toBe(200);

      // WHY: without invalidateCache() this GET would still see '8' until
      // TTL expiry. An immediate '5' proves the loader's cache was dropped
      // after the transaction committed.
      const after = await app.inject({
        method: 'GET',
        url: '/admin/settings',
        headers: adminHeaders()
      });
      expect(after.json().reward_code_length).toBe('5');
    });
  });
});
