/**
 * FILE: backend/tests/settings.test.ts
 * PURPOSE: Integration tests for the settings loader against a real Postgres
 *          instance. Verifies typed getters, parse-failure behavior, and the
 *          TTL-based cache + invalidateCache() contract.
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/settings/loader.ts, backend/src/db/prisma.ts,
 *        backend/src/errors.ts.
 *
 * PREREQUISITES:
 *   - Postgres running (docker compose up -d)
 *   - Migrations applied (npx prisma migrate deploy OR migrate dev)
 *   - Seed executed (npx prisma db seed) so `points_per_referral` exists
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { prisma } from '../src/db/prisma.js';
import { settings } from '../src/settings/loader.js';
import { InternalError } from '../src/errors.js';

// WHY: use a dedicated test-only key so tests never collide with seeded rows
// and cleanup is a single deleteMany. The leading underscores make stray rows
// easy to spot in psql if cleanup fails.
const TEST_KEY = '__test_settings_loader';

describe('settings loader', () => {
  beforeAll(async () => {
    // Start from a clean slate in case a previous run crashed mid-test.
    await prisma.setting.deleteMany({ where: { key: TEST_KEY } });
    settings.invalidateCache();
  });

  afterEach(async () => {
    // WHY: parallel test files would otherwise see a stale cache. This file
    // is currently serial, but the habit pays off when we add more.
    await prisma.setting.deleteMany({ where: { key: TEST_KEY } });
    settings.invalidateCache();
  });

  afterAll(async () => {
    // WHY: Prisma keeps a pool open; disconnecting here lets vitest exit
    // cleanly instead of warning about leaked handles.
    await prisma.$disconnect();
  });

  it('get() returns the raw string value of a seeded setting', async () => {
    // Requires `prisma db seed` to have run — see PREREQUISITES in header.
    const raw = await settings.get('points_per_referral');
    expect(typeof raw).toBe('string');
    expect(raw).toMatch(/^-?\d+$/);
  });

  it('getPointsPerReferral() returns a positive integer', async () => {
    const points = await settings.getPointsPerReferral();
    expect(Number.isInteger(points)).toBe(true);
    expect(points).toBeGreaterThan(0);
  });

  it('throws InternalError when the key is not configured', async () => {
    await expect(settings.get('__does_not_exist__')).rejects.toBeInstanceOf(
      InternalError
    );
  });

  it('throws InternalError when asInt cannot parse the value', async () => {
    await prisma.setting.create({
      data: { key: TEST_KEY, value: 'not_a_number' }
    });
    settings.invalidateCache();
    await expect(settings.asInt(TEST_KEY)).rejects.toBeInstanceOf(InternalError);
  });

  it('throws InternalError when asFloat sees trailing garbage', async () => {
    // WHY: Number.parseFloat("1.5xyz") === 1.5 — silent corruption risk.
    // The loader rejects anything that does not round-trip cleanly.
    await prisma.setting.create({
      data: { key: TEST_KEY, value: '1.5xyz' }
    });
    settings.invalidateCache();
    await expect(settings.asFloat(TEST_KEY)).rejects.toBeInstanceOf(InternalError);
  });

  it('serves stale value from cache until invalidateCache() is called', async () => {
    await prisma.setting.create({ data: { key: TEST_KEY, value: '1' } });
    settings.invalidateCache();

    // First read populates the cache.
    expect(await settings.asInt(TEST_KEY)).toBe(1);

    // Mutate the DB directly — the loader should NOT see this yet, because
    // the default TTL (30s) has not elapsed within the test.
    await prisma.setting.update({
      where: { key: TEST_KEY },
      data: { value: '2' }
    });
    expect(await settings.asInt(TEST_KEY)).toBe(1);

    // Explicit invalidation forces a fresh read from the DB.
    settings.invalidateCache();
    expect(await settings.asInt(TEST_KEY)).toBe(2);
  });

  it('throws InternalError for malformed SETTINGS_CACHE_TTL_SECONDS', async () => {
    // WHY: fail loud on misconfig — silently falling back to a default would
    // hide an operator typo like "30s" instead of "30".
    const previous = process.env.SETTINGS_CACHE_TTL_SECONDS;
    process.env.SETTINGS_CACHE_TTL_SECONDS = 'not_a_number';
    settings.invalidateCache();

    try {
      await expect(
        settings.get('points_per_referral')
      ).rejects.toBeInstanceOf(InternalError);
    } finally {
      // WHY: always restore env — other test files may rely on the default.
      if (previous === undefined) {
        delete process.env.SETTINGS_CACHE_TTL_SECONDS;
      } else {
        process.env.SETTINGS_CACHE_TTL_SECONDS = previous;
      }
      settings.invalidateCache();
    }
  });
});
