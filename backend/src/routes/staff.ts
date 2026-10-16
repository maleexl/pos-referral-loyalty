/**
 * FILE: backend/src/routes/staff.ts
 * PURPOSE: Staff-facing endpoints. All routes in this plugin require a valid
 *          X-Staff-Key header — enforced by a plugin-scoped onRequest hook so
 *          the auth contract cannot be forgotten by a new route.
 * CALLED BY: backend/src/app.ts (registered with prefix /staff).
 * CALLS: backend/src/usecases/issueRedemption.ts,
 *        backend/src/usecases/confirmRedemption.ts,
 *        backend/src/auth/apiKey.ts, backend/src/errors.ts.
 */
import type { FastifyInstance } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import { readApiKey, isValidApiKey } from '../auth/apiKey.js';
import { issueRedemption } from '../usecases/issueRedemption.js';
import { confirmRedemption } from '../usecases/confirmRedemption.js';

export async function staffRoutes(app: FastifyInstance): Promise<void> {
  const expectedKey = readApiKey('STAFF_API_KEY');

  // WHY: onRequest (not preHandler) — runs before body parsing, so an
  // unauthenticated request never has its payload read or validated.
  // WHY plugin-scoped: the hook only applies to routes registered inside
  // this function. Removing the plugin unregisters both routes AND auth —
  // no risk of a global hook accidentally gating public endpoints.
  app.addHook('onRequest', async (req) => {
    // WHY: shared helper — constant-time compare + type guard (rejects arrays).
    if (!isValidApiKey(req.headers['x-staff-key'], expectedKey)) {
      throw new UnauthorizedError('Invalid or missing staff key');
    }
  });

  // --- POST /staff/redeem -------------------------------------------------
  app.post('/redeem', async (req, reply) => {
    const result = await issueRedemption(req.body);
    reply.status(200).send({
      redemptionCode: result.redemptionCode,
      pointsUsed: result.pointsUsed,
      pointsRemaining: result.pointsRemaining,
      expiresAt: result.expiresAt.toISOString()
    });
  });

  // --- POST /staff/redeem/confirm -----------------------------------------
  app.post('/redeem/confirm', async (req, reply) => {
    const result = await confirmRedemption(req.body);
    reply.status(200).send({
      status: result.status,
      redeemedAt: result.redeemedAt.toISOString()
    });
  });
}
