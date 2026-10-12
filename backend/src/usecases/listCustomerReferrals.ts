/**
 * FILE: backend/src/usecases/listCustomerReferrals.ts
 * PURPOSE: Lists referrals where the given referralCode's owner is the
 *          referrer. Public read-only view for the customer dashboard
 *          (SPEC F2 + docs/API-CONTRACT.md §F2 /api/customers/*).
 * CALLED BY: backend/src/routes/customers.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/errors.ts, @prisma/client.
 */
import type { ReferralStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { NotFoundError } from '../errors.js';

export interface CustomerReferralItem {
  id: string;
  status: ReferralStatus;
  createdAt: Date;
  completedAt: Date | null;
  referee: {
    id: string;
    name: string;
    referralCode: string;
  };
}

export interface ListCustomerReferralsResult {
  items: CustomerReferralItem[];
}

export async function listCustomerReferrals(
  referralCode: string
): Promise<ListCustomerReferralsResult> {
  // WHY: mirror getCustomerByCode — a nonexistent code yields 404, not 400.
  // Any string is a valid lookup key; the failure mode is "not found", not
  // "malformed". Validating the shape here would only reclassify the error.
  const referrer = await prisma.customer.findUnique({
    where: { referralCode },
    select: { id: true }
  });
  if (!referrer) {
    throw new NotFoundError(`Customer with code "${referralCode}" not found`);
  }

  // WHY: no pagination — one customer's referral list is bounded in practice
  // (a top referrer at an MVP-scale shop might have dozens, not thousands).
  // Pagination would add a params contract with no user-visible benefit.
  //
  // WHY: no referrer fields in the response — the caller owns this code, so
  // repeating their own id/name/code per row is pure payload bloat. The
  // referee is the only side the customer cannot already see.
  const items = await prisma.referral.findMany({
    where: { referrerId: referrer.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      createdAt: true,
      completedAt: true,
      referee: { select: { id: true, name: true, referralCode: true } }
    }
  });

  return { items };
}
