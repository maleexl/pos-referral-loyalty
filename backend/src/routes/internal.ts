/**
 * FILE: backend/src/routes/internal.ts
 * PURPOSE: HTTP layer for internal / mock endpoints. In the MVP the mock POS
 *          lives here; a real POS integration would replace it with a signed
 *          webhook receiver (see SPEC §7 "Real POS integration" out of scope).
 *          Response shape matches API-CONTRACT F2 /internal/mock-pos/visits.
 * CALLED BY: backend/src/app.ts (registered as a route group).
 * CALLS: backend/src/usecases/recordPosVisit.ts.
 */
import type { FastifyInstance } from 'fastify';
import { recordPosVisit } from '../usecases/recordPosVisit.js';

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  // --- POST /internal/mock-pos/visits -------------------------------------
  // WHY: no auth — this endpoint stands in for the POS. Auth arrives when
  // the real integration ships (signed webhook, mTLS, or API key); the
  // /internal prefix keeps it clearly separated from the public /api surface
  // and makes a future "reject /internal in prod" rule a one-line change.
  app.post('/internal/mock-pos/visits', async (req, reply) => {
    const result = await recordPosVisit(req.body);
    reply.status(200).send({
      visitId: result.visitId,
      // WHY: ISO strings on the wire, matching every other endpoint.
      visitedAt: result.visitedAt.toISOString(),
      referralCompleted: result.referralCompleted,
      pointsAwarded: result.pointsAwarded,
      referrerCode: result.referrerCode
    });
  });
}
