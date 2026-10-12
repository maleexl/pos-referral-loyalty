/**
 * FILE: backend/src/usecases/listReferrals.ts
 * PURPOSE: Paginated, filterable listing of referrals for the admin UI.
 *          Returns items plus total count so the client can render page
 *          controls without a second call.
 * CALLED BY: backend/src/routes/admin.ts
 * CALLS: backend/src/db/prisma.ts, @prisma/client, zod.
 */
import { z } from 'zod';
import { ReferralStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';

// WHY: named constants — the same values must be reflected in the route
// validation and the admin UI pagination control. See API-CONTRACT §F4.
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// WHY: allow filtering by status. z.nativeEnum ties the enum values to Prisma's
// generated ReferralStatus, so a schema change (e.g. adding CANCELLED) does
// not require a matching update here.
export const ListReferralsQuery = z.object({
  status: z.nativeEnum(ReferralStatus).optional(),
  // WHY: coerce — query params arrive as strings; .int() then rejects "1.5".
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
});
export type ListReferralsQuery = z.infer<typeof ListReferralsQuery>;

// Nested projections — we deliberately omit email/phone so the admin list
// does not leak PII the UI does not need. Add them explicitly if the UI needs them.
const REFERRER_SELECT = { id: true, name: true, referralCode: true } as const;
const REFEREE_SELECT = { id: true, name: true, referralCode: true } as const;

export interface ListReferralsItem {
  id: string;
  status: ReferralStatus;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
  referrer: { id: string; name: string; referralCode: string };
  referee: { id: string; name: string; referralCode: string };
}

export interface ListReferralsResult {
  total: number;
  page: number;
  limit: number;
  items: ListReferralsItem[];
}

export async function listReferrals(input: unknown): Promise<ListReferralsResult> {
  const query = ListReferralsQuery.parse(input);

  // WHY: build the where clause conditionally — passing `status: undefined`
  // to Prisma's `findMany` is fine, but making the intent explicit here keeps
  // the count and findMany calls trivially in sync if the filter grows.
  const where = query.status ? { status: query.status } : {};

  // WHY: run count and page in parallel — they are independent reads and
  // share the same where clause. On a slow CI runner this halves latency.
  const [total, items] = await Promise.all([
    prisma.referral.count({ where }),
    prisma.referral.findMany({
      where,
      // WHY: newest first — admin wants to see recent activity.
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        status: true,
        createdAt: true,
        completedAt: true,
        expiresAt: true,
        referrer: { select: REFERRER_SELECT },
        referee: { select: REFEREE_SELECT }
      }
    })
  ]);

  return {
    total,
    page: query.page,
    limit: query.limit,
    items
  };
}
