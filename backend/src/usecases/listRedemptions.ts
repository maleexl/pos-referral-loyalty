/**
 * FILE: backend/src/usecases/listRedemptions.ts
 * PURPOSE: Paginated listing of REDEMPTION rewards for the admin UI. "Redemption"
 *          here means any ledger entry with type=REDEMPTION (issued, confirmed,
 *          or expired) — the status field distinguishes them per row.
 * CALLED BY: backend/src/routes/admin.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/constants.ts, @prisma/client, zod.
 */
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { REWARD_TYPE, type RewardStatus } from '../constants.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE
} from './listReferrals.js';

// WHY: no status filter — API-CONTRACT §F4 lists only page/limit for
// /admin/redemptions. Add a filter later if the UI needs one; the shape stays
// compatible (extra optional fields are additive).
export const ListRedemptionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
});
export type ListRedemptionsQuery = z.infer<typeof ListRedemptionsQuery>;

export interface ListRedemptionsItem {
  id: string;
  customerId: string;
  customerCode: string;
  points: number;
  code: string | null;
  status: RewardStatus;
  createdAt: Date;
  redeemedAt: Date | null;
  expiresAt: Date | null;
}

export interface ListRedemptionsResult {
  total: number;
  page: number;
  limit: number;
  items: ListRedemptionsItem[];
}

export async function listRedemptions(
  input: unknown
): Promise<ListRedemptionsResult> {
  const query = ListRedemptionsQuery.parse(input);
  // WHY: fixed where — we only surface REDEMPTION entries, never referral
  // bonuses. The referral bonuses have their own lifecycle and are not
  // actionable by an admin looking at redemption codes.
  const where = { type: REWARD_TYPE.REDEMPTION };

  const [total, rows] = await Promise.all([
    prisma.reward.count({ where }),
    prisma.reward.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        customerId: true,
        points: true,
        redemptionCode: true,
        status: true,
        createdAt: true,
        redeemedAt: true,
        expiresAt: true,
        // WHY: include the customer's referralCode so the admin table can
        // display a stable identifier without a second call.
        customer: { select: { referralCode: true } }
      }
    })
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    items: rows.map((r) => ({
      id: r.id,
      customerId: r.customerId,
      customerCode: r.customer.referralCode,
      points: r.points,
      code: r.redemptionCode,
      status: r.status,
      createdAt: r.createdAt,
      redeemedAt: r.redeemedAt,
      expiresAt: r.expiresAt
    }))
  };
}
