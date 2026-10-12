/**
 * FILE: backend/src/routes/customers.ts
 * PURPOSE: HTTP layer for Customer resource. Wires requests to usecases;
 *          no business logic here. Response shapes match docs/API-CONTRACT.md F1.
 * CALLED BY: backend/src/app.ts (registered as a route group).
 * CALLS: backend/src/usecases/registerCustomer.ts,
 *        backend/src/usecases/getCustomerByCode.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { Reward } from '@prisma/client';
import { registerCustomer } from '../usecases/registerCustomer.js';
import { getCustomerByCode } from '../usecases/getCustomerByCode.js';
import { listCustomerRewards } from '../usecases/listCustomerRewards.js';

// WHY: shape the customer for the wire. Keep this next to the routes so the
// API contract has exactly one place to change if the frontend needs more.
// Never expose internal fields we might add later (e.g. soft-delete flags).
function toApi(customer: {
  id: string;
  email: string;
  phone: string;
  name: string;
  referralCode: string;
  createdAt: Date;
}): {
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
    // WHY: pointsBalance is derived (SUM of ledger). New customers have no
    // rewards yet, so it is always 0 here. Later endpoints that read
    // rewards will compute the real balance.
    pointsBalance: 0,
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
      return toApi(customer);
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
}
