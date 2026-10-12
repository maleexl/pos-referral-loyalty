/**
 * FILE: backend/src/usecases/recordPosVisit.ts
 * PURPOSE: Records a POS visit and, if the visiting customer has a live
 *          PENDING referral as referee, completes it atomically — marking
 *          the referral COMPLETED and crediting the referrer with a signed
 *          REFERRAL_BONUS ledger entry. Idempotent: re-visits of a
 *          completed/expired referral do not double-credit.
 * CALLED BY: backend/src/routes/internal.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/settings/loader.ts,
 *        backend/src/constants.ts, backend/src/errors.ts,
 *        backend/src/usecases/registerCustomer.ts (for P2002 helper),
 *        @prisma/client, zod.
 */
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { settings } from '../settings/loader.js';
import {
  ConflictError,
  GoneError,
  NotFoundError
} from '../errors.js';
import { isPrismaUniqueViolation } from './registerCustomer.js';
import {
  REFERRAL_STATUS,
  REWARD_STATUS,
  REWARD_TYPE
} from '../constants.js';

// --- Named constants ------------------------------------------------------
const NAME_MAX_LENGTH = 500;
// WHY: PosVisit.amount is an Int in the schema (satang for THB). Negative
// amounts are nonsensical for a POS visit, so reject at the boundary.
const AMOUNT_MIN = 0;

// --- API-CONTRACT F2 error codes (internal/mock-pos) ----------------------
const CODE_CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND';
const CODE_REFERRAL_ALREADY_COMPLETED = 'REFERRAL_ALREADY_COMPLETED';
const CODE_REFERRAL_EXPIRED = 'REFERRAL_EXPIRED';

// --- Zod input schema -----------------------------------------------------
export const RecordVisitInput = z.object({
  customerEmail: z.string().email(),
  // WHY: integer only — the schema stores Int. Fractional baht (satang) is
  // a future concern; changing the scale would be a schema migration.
  amount: z.number().int().min(AMOUNT_MIN),
  note: z.string().max(NAME_MAX_LENGTH).optional()
});
export type RecordVisitInput = z.infer<typeof RecordVisitInput>;

// --- Result type (matches API-CONTRACT F2 /mock-pos/visits) ---------------
export interface RecordVisitResult {
  visitId: string;
  visitedAt: Date;
  referralCompleted: boolean;
  pointsAwarded: number;
  referrerCode: string | null;
}

// --- Usecase --------------------------------------------------------------
export async function recordPosVisit(
  input: unknown
): Promise<RecordVisitResult> {
  const data = RecordVisitInput.parse(input);

  // 1) Locate the customer BEFORE any write — PosVisit.customerId is a FK,
  //    and a 404 here avoids a pointless visit row.
  const customer = await prisma.customer.findUnique({
    where: { email: data.customerEmail }
  });
  if (!customer) {
    throw new NotFoundError(
      `Customer with email "${data.customerEmail}" not found`,
      CODE_CUSTOMER_NOT_FOUND
    );
  }

  // 2) Always persist the visit first (SPEC F2: "visit still recorded").
  //    This is a standalone write, NOT part of the referral-completion
  //    transaction below — a rejected referral still leaves the visit.
  const visit = await prisma.posVisit.create({
    data: {
      customerId: customer.id,
      amount: data.amount,
      note: data.note ?? null
    }
  });

  // 3) Look up the referral where this customer is the referee.
  //    UNIQUE(refereeId) guarantees at most one row — findUnique is correct.
  const referral = await prisma.referral.findUnique({
    where: { refereeId: customer.id },
    include: { referrer: true }
  });

  // 4) No referral → success with referralCompleted=false. Common case for
  //    repeat visits (referral already consumed) or non-referred customers.
  if (!referral) {
    return {
      visitId: visit.id,
      visitedAt: visit.visitedAt,
      referralCompleted: false,
      pointsAwarded: 0,
      referrerCode: null
    };
  }

  // 5) Already-completed referral: idempotent. Do NOT re-issue reward.
  //    Return enough visit info for the client to reconcile.
  if (referral.status === REFERRAL_STATUS.COMPLETED) {
    throw new ConflictError(
      'Referral already completed',
      CODE_REFERRAL_ALREADY_COMPLETED,
      {
        visitId: visit.id,
        visitedAt: visit.visitedAt.toISOString(),
        referralCompleted: false,
        pointsAwarded: 0
      }
    );
  }

  // 6) Expired — either a prior request flipped the status, or the deadline
  //    has passed since the referral was created (BR-4).
  const now = new Date();
  if (
    referral.status === REFERRAL_STATUS.EXPIRED ||
    referral.expiresAt < now
  ) {
    // WHY: lazily flip PENDING→EXPIRED the first time we observe the lapse.
    // Doing it here (not on a cron) keeps the MVP simple; the status is
    // only meaningful relative to a visit or admin query.
    if (referral.status === REFERRAL_STATUS.PENDING) {
      await prisma.referral.update({
        where: { id: referral.id },
        data: { status: REFERRAL_STATUS.EXPIRED }
      });
    }
    throw new GoneError('Referral expired', CODE_REFERRAL_EXPIRED, {
      visitId: visit.id,
      visitedAt: visit.visitedAt.toISOString(),
      referralCompleted: false,
      pointsAwarded: 0
    });
  }

  // 7) PENDING and within deadline → complete the referral atomically.
  // WHY read settings OUTSIDE the transaction: the settings loader may do a
  // DB read on cache miss; keeping that work out of TX2 keeps the tx short.
  const pointsPerReferral = await settings.getPointsPerReferral();

  try {
    const awarded = await prisma.$transaction(async (tx) => {
      // 7a) Optimistic lock: only flip if still PENDING. Under a race, the
      //     loser sees count=0 and we abort — no double reward, no lost update.
      const updated = await tx.referral.updateMany({
        where: { id: referral.id, status: REFERRAL_STATUS.PENDING },
        data: { status: REFERRAL_STATUS.COMPLETED, completedAt: now }
      });
      if (updated.count === 0) {
        // Another request won the race between our lookup and this update.
        throw new ConflictError(
          'Referral already completed',
          CODE_REFERRAL_ALREADY_COMPLETED,
          {
            visitId: visit.id,
            visitedAt: visit.visitedAt.toISOString(),
            referralCompleted: false,
            pointsAwarded: 0
          }
        );
      }

      // 7b) Create the ledger entry for the REFERRER. Points are positive
      //     (earn); balance is derived as SUM(points), no separate column.
      await tx.reward.create({
        data: {
          customerId: referral.referrerId,
          type: REWARD_TYPE.REFERRAL_BONUS,
          points: pointsPerReferral,
          status: REWARD_STATUS.ISSUED,
          referralId: referral.id
        }
      });

      return pointsPerReferral;
    });

    return {
      visitId: visit.id,
      visitedAt: visit.visitedAt,
      referralCompleted: true,
      pointsAwarded: awarded,
      referrerCode: referral.referrer.referralCode
    };
  } catch (err) {
    // WHY: second line of defense. The optimistic lock above should prevent
    // a concurrent duplicate, but UNIQUE(referralId, type) is the ultimate
    // invariant — if it ever fires, translate to the same 409 rather than
    // surfacing a raw P2002 as a 500.
    if (isPrismaUniqueViolation(err, ['referralId', 'type'])) {
      throw new ConflictError(
        'Referral already completed',
        CODE_REFERRAL_ALREADY_COMPLETED,
        {
          visitId: visit.id,
          visitedAt: visit.visitedAt.toISOString(),
          referralCompleted: false,
          pointsAwarded: 0
        }
      );
    }
    throw err;
  }
}
