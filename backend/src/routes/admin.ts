/**
 * FILE: backend/src/routes/admin.ts
 * PURPOSE: Admin-facing endpoints. All routes in this plugin require a valid
 *          X-Admin-Key header, enforced by a plugin-scoped onRequest hook so
 *          the auth contract cannot be forgotten by a new route. Response
 *          shapes match docs/API-CONTRACT.md §F4.
 * CALLED BY: backend/src/app.ts (registered with prefix /admin).
 * CALLS: backend/src/usecases/listReferrals.ts,
 *        backend/src/usecases/listRedemptions.ts,
 *        backend/src/usecases/getAllSettings.ts,
 *        backend/src/usecases/updateSettings.ts,
 *        backend/src/auth/apiKey.ts, backend/src/errors.ts.
 */
import type { FastifyInstance } from 'fastify';
import { UnauthorizedError } from '../errors.js';
import { readApiKey, isValidApiKey } from '../auth/apiKey.js';
import { listReferrals } from '../usecases/listReferrals.js';
import { listRedemptions } from '../usecases/listRedemptions.js';
import { getAllSettings } from '../usecases/getAllSettings.js';
import { updateSettings } from '../usecases/updateSettings.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const expectedKey = readApiKey('ADMIN_API_KEY');

  // WHY plugin-scoped onRequest: runs before body parsing on every route in
  // this file only. Removing this plugin unregisters the routes AND the auth
  // in one move — no risk of a global hook accidentally gating public paths.
  app.addHook('onRequest', async (req) => {
    // WHY: shared helper — constant-time compare + type guard (rejects arrays).
    if (!isValidApiKey(req.headers['x-admin-key'], expectedKey)) {
      throw new UnauthorizedError('Invalid or missing admin key');
    }
  });

  // --- GET /admin/referrals?status=&page=&limit= --------------------------
  app.get('/referrals', async (req) => {
    // WHY: pass req.query verbatim — the usecase's zod schema coerces and
    // validates page/limit; invalid values bubble up as 400 INVALID_INPUT.
    const { total, page, limit, items } = await listReferrals(req.query);
    return {
      total,
      page,
      limit,
      items: items.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        expiresAt: r.expiresAt.toISOString(),
        referrer: r.referrer,
        referee: r.referee
      }))
    };
  });

  // --- GET /admin/redemptions?page=&limit= --------------------------------
  app.get('/redemptions', async (req) => {
    const { total, page, limit, items } = await listRedemptions(req.query);
    return {
      total,
      page,
      limit,
      items: items.map((r) => ({
        id: r.id,
        customerCode: r.customerCode,
        points: r.points,
        code: r.code,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null
      }))
    };
  });

  // --- GET /admin/settings ------------------------------------------------
  // WHY no wrapper object: API-CONTRACT §F4 shows a flat map (key → value
  // string). Adding an envelope now would break the documented shape.
  app.get('/settings', async () => {
    return getAllSettings();
  });

  // --- PATCH /admin/settings ----------------------------------------------
  // WHY 200 (not 204): the response body carries the full updated settings
  // map so the client can reconcile its UI in one roundtrip.
  app.patch('/settings', async (req) => {
    return updateSettings(req.body);
  });
}
