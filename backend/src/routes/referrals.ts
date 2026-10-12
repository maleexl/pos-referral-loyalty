/**
 * FILE: backend/src/routes/referrals.ts
 * PURPOSE: HTTP layer for Referral resource. Wires requests to usecases and
 *          shapes the response to match docs/API-CONTRACT.md F2.
 * CALLED BY: backend/src/app.ts (registered as a route group).
 * CALLS: backend/src/usecases/createReferral.ts.
 */
import type { FastifyInstance } from 'fastify';
import { createReferral } from '../usecases/createReferral.js';

export async function referralRoutes(app: FastifyInstance): Promise<void> {
  // --- POST /api/referrals ------------------------------------------------
  app.post('/api/referrals', async (req, reply) => {
    // WHY: pass raw body to the usecase — zod parse errors bubble up and the
    // global handler maps them to 400 INVALID_INPUT with details.
    const result = await createReferral(req.body);
    reply.status(201).send({
      referralId: result.referralId,
      status: result.status,
      // WHY: ISO strings on the wire, not Date — keeps the contract stable
      // across JSON serializers and matches API-CONTRACT examples.
      createdAt: result.createdAt.toISOString(),
      expiresAt: result.expiresAt.toISOString(),
      referee: result.referee
    });
  });
}
