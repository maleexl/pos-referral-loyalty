/**
 * FILE: backend/tests/customers.test.ts
 * PURPOSE: Integration tests for POST/GET /api/customers. Hits the real app
 *          via inject() and a real DB, verifying status codes, response shape,
 *          and error mapping for F1 (docs/API-CONTRACT.md).
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, backend/src/db/prisma.ts.
 *
 * PREREQUISITES: Postgres running + migrations applied.
 * Test isolation: all emails are prefixed `test-customer-` so afterAll can
 * delete them in one call without disturbing seeded data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';

const TEST_EMAIL_PREFIX = 'test-customer-';

function testEmail(suffix: string): string {
  return `${TEST_EMAIL_PREFIX}${suffix}@example.com`;
}

// WHY: distinct phone per test in a clearly test-only range (09900xxxxx).
// Thai mobile numbers are 10 digits total, so 09900 + 5-digit suffix fits.
function testPhone(n: number): string {
  return `09900${String(n).padStart(5, '0')}`;
}

describe('POST/GET /api/customers', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // WHY: buildApp does not listen() — inject() routes through the router
    // in-process. logger:false keeps CI output clean.
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // WHY: single sweep by email prefix — safe even if a test failed midway.
    // cascade deletes are not an issue: no FK points to a Customer yet in
    // this test suite (rewards/referrals come in later steps).
    await prisma.customer.deleteMany({
      where: { email: { startsWith: TEST_EMAIL_PREFIX } }
    });
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /api/customers → 201 with API-CONTRACT shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('happy'),
        phone: testPhone(1),
        name: 'Alice Smith'
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      email: testEmail('happy'),
      phone: testPhone(1),
      name: 'Alice Smith',
      pointsBalance: 0
    });
    expect(typeof body.id).toBe('string');
    // WHY: verify prefix comes from name, suffix is alphanumeric — this is
    // the observable contract of generateReferralCode().
    expect(body.referralCode).toMatch(/^ALICE[A-Z0-9]{4}$/);
    expect(typeof body.createdAt).toBe('string');
  });

  it('POST duplicate email → 409 EMAIL_EXISTS', async () => {
    // Create the first one, then attempt the same email with different phone.
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('dup-email'),
        phone: testPhone(2),
        name: 'First'
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('dup-email'),
        phone: testPhone(3),
        name: 'Second'
      }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'EMAIL_EXISTS' });
  });

  it('POST duplicate phone → 409 PHONE_EXISTS', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('dup-phone-a'),
        phone: testPhone(4),
        name: 'First'
      }
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('dup-phone-b'),
        phone: testPhone(4),
        name: 'Second'
      }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'PHONE_EXISTS' });
  });

  it('POST invalid email → 400 INVALID_INPUT with Zod details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: 'not-an-email',
        phone: testPhone(5),
        name: 'Alice'
      }
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body).toMatchObject({ code: 'INVALID_INPUT' });
    // WHY: details must carry the field name so the frontend can highlight it.
    expect(body.details).toBeDefined();
    expect(body.details.email).toBeDefined();
  });

  it('GET /api/customers/:referralCode → 200 with customer', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        email: testEmail('lookup'),
        phone: testPhone(6),
        name: 'Bob Jones'
      }
    });
    const createdBody = created.json();

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${createdBody.referralCode}`
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: createdBody.id,
      email: testEmail('lookup'),
      referralCode: createdBody.referralCode,
      pointsBalance: 0
    });
  });

  it('GET /api/customers/UNKNOWN → 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/ZZZZZZZZ'
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
