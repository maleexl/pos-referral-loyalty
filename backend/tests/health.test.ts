/**
 * FILE: backend/tests/health.test.ts
 * PURPOSE: Integration test for GET /health. Uses Fastify's inject() so no
 *          real TCP port is opened and the test is deterministic in CI.
 * CALLED BY: vitest (npm test).
 * CALLS: backend/src/app.ts, vitest.
 */
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    // WHY: logger false keeps CI output clean; buildApp() does not listen(),
    // so this test never binds a port.
    const app = await buildApp({ logger: false });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ok',
      service: 'pos-referral-loyalty-backend'
    });

    await app.close();
  });
});
