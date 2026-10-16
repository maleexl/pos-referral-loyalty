/**
 * FILE: backend/src/routes/customers.ts
 * PURPOSE: HTTP layer for Customer resource. Wires requests to usecases;
 *          no business logic here. Response shapes match docs/API-CONTRACT.md F1.
 * CALLED BY: backend/src/app.ts (registered as a route group).
 * CALLS: backend/src/usecases/registerCustomer.ts,
 *        backend/src/usecases/getCustomerByCode.ts,
 *        backend/src/usecases/listCustomerRewards.ts,
 *        backend/src/usecases/listCustomerReferrals.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { Reward } from '@prisma/client';
import { registerCustomer } from '../usecases/registerCustomer.js';
import { getCustomerByCode } from '../usecases/getCustomerByCode.js';
import { listCustomerRewards, computePointsBalance } from '../usecases/listCustomerRewards.js';
import { listCustomerReferrals } from '../usecases/listCustomerReferrals.js';

// WHY: shape the customer for the wire. Keep this next to the routes so the
// API contract has exactly one place to change if the frontend needs more.
// Never expose internal fields we might add later (e.g. soft-delete flags).
// WHY: pointsBalance is derived from the ledger, not a column on Customer, so
// the caller computes it and passes it in. It defaults to 0 so create
// responses (a brand-new customer has no rewards) match API-CONTRACT F1.
function toApi(
  customer: {
    id: string;
    email: string;
    phone: string;
    name: string;
    referralCode: string;
    createdAt: Date;
  },
  pointsBalance = 0
): {
  id: string;
  email: string;
  phone: string;
  name: string;
  referralCode: string;
  pointsBalance: number;
  createdAt: string;
} {
  return {
    id: customer.id,
    email: customer.email,
    phone: customer.phone,
    name: customer.name,
    referralCode: customer.referralCode,
    pointsBalance,
    createdAt: customer.createdAt.toISOString()
  };
}

// WHY: rewards carry optional redemption fields; emitting them conditionally
// keeps the payload small for REFERRAL_BONUS rows and informative for
// REDEMPTION rows (staff UI needs the code + expiry without a second call).
function toRewardApi(reward: Reward): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: reward.id,
    type: reward.type,
    // WHY: `points` is signed (positive = earn, negative = spend). We surface
    // the raw signed value so the frontend can render +/- consistently.
    points: reward.points,
    status: reward.status,
    createdAt: reward.createdAt.toISOString()
  };
  if (reward.redemptionCode !== null) base.redemptionCode = reward.redemptionCode;
  if (reward.expiresAt !== null) base.expiresAt = reward.expiresAt.toISOString();
  if (reward.redeemedAt !== null) base.redeemedAt = reward.redeemedAt.toISOString();
  if (reward.referralId !== null) base.referralId = reward.referralId;
  return base;
}

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  // --- POST /api/customers ------------------------------------------------
  app.post('/api/customers', async (req, reply) => {
    // WHY: pass raw body to the usecase — zod parse errors bubble to the
    // global error handler and become 400 INVALID_INPUT with details.
    const customer = await registerCustomer(req.body);
    reply.status(201).send(toApi(customer));
  });

  // --- GET /api/customers/:referralCode -----------------------------------
  app.get<{ Params: { referralCode: string } }>(
    '/api/customers/:referralCode',
    async (req) => {
      const customer = await getCustomerByCode(req.params.referralCode);
      // WHY: same computation as GET .../rewards (F3) so the two endpoints
      // can never disagree about a customer's balance (AUD-001).
      const pointsBalance = await computePointsBalance(customer.id);
      return toApi(customer, pointsBalance);
    }
  );

  // --- GET /api/customers/:referralCode/rewards ---------------------------
  // WHY: Fastify matches this more specific path before the param-only
  // route above; ordering in the file does not matter, but keeping the
  // resource nested reads more clearly.
  app.get<{ Params: { referralCode: string } }>(
    '/api/customers/:referralCode/rewards',
    async (req) => {
      const { pointsBalance, rewards } = await listCustomerRewards(
        req.params.referralCode
      );
      return {
        pointsBalance,
        rewards: rewards.map(toRewardApi)
      };
    }
  );

  // --- GET /api/customers/:referralCode/referrals -------------------------
  // WHY public (no auth): same class of read as GET /api/customers/:code
  // and GET /api/customers/:code/rewards — a customer inspecting their own
  // record. The referralCode itself is the capability token; anyone who
  // knows it is already trusted with this data by the design in DECISIONS #5.
  app.get<{ Params: { referralCode: string } }>(
    '/api/customers/:referralCode/referrals',
    async (req) => {
      const { items } = await listCustomerReferrals(req.params.referralCode);
      return {
        items: items.map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          referee: r.referee
        }))
      };
    }
  );
}
