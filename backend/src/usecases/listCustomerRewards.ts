/**
 * FILE: backend/src/usecases/listCustomerRewards.ts
 * PURPOSE: Loads a customer's reward ledger and computes their current points
 *          balance. Balance is derived (never stored) per the ledger pattern
 *          in docs/DECISIONS.md #3.
 * CALLED BY: backend/src/routes/customers.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/errors.ts, backend/src/constants.ts.
 */
import type { Customer, Prisma, Reward } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { NotFoundError } from '../errors.js';
import { REWARD_STATUS } from '../constants.js';

export interface ListCustomerRewardsResult {
  customer: Customer;
  pointsBalance: number;
  rewards: Reward[];
}

// WHY exported: GET /api/customers/:code (F1) and GET .../rewards (F3) must
// report the exact same balance. One helper keeps the filter (the definition
// of "active") in a single place so the two endpoints cannot drift.
export async function computePointsBalance(
  customerId: string,
  client: Prisma.TransactionClient = prisma
): Promise<number> {
  // WHY: filter by status IN (ISSUED, REDEEMED) — EXPIRED rewards must NOT
  // count toward balance. An ISSUED redemption already reserves the points
  // (negative ledger entry), so it stays in the sum until explicitly
  // refunded via a REFUND entry (a future step; see SPEC §F3 expiry handling).
  const aggregate = await client.reward.aggregate({
    where: {
      customerId,
      status: { in: [REWARD_STATUS.ISSUED, REWARD_STATUS.REDEEMED] }
    },
    _sum: { points: true }
  });
  // WHY: Prisma returns null when there are zero matching rows. Coalesce to 0
  // so the API never has to special-case "no rewards yet".
  return aggregate._sum.points ?? 0;
}

export async function listCustomerRewards(
  referralCode: string
): Promise<ListCustomerRewardsResult> {
  const customer = await prisma.customer.findUnique({
    where: { referralCode }
  });
  if (!customer) {
    throw new NotFoundError(`Customer with code "${referralCode}" not found`);
  }

  const pointsBalance = await computePointsBalance(customer.id);

  const rewards = await prisma.reward.findMany({
    where: { customerId: customer.id },
    // WHY: newest first — matches UI expectations and API-CONTRACT example.
    orderBy: { createdAt: 'desc' }
  });

  return { customer, pointsBalance, rewards };
}
