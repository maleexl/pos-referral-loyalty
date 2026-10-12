/**
 * FILE: backend/src/usecases/confirmRedemption.ts
 * PURPOSE: Confirms a previously issued redemption. Marks the REDEMPTION
 *          ledger entry as REDEEMED with a timestamp. Idempotent against
 *          races: a second confirm sees count=0 and reports 409.
 * CALLED BY: backend/src/routes/staff.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/constants.ts,
 *        backend/src/errors.ts, @prisma/client, zod.
 */
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import {
  ConflictError,
  GoneError,
  NotFoundError
} from '../errors.js';
import {
  REWARD_STATUS,
  REWARD_TYPE
} from '../constants.js';

// --- API-CONTRACT F3 error codes (confirm) --------------------------------
const CODE_NOT_FOUND = 'CODE_NOT_FOUND';
const CODE_ALREADY_REDEEMED = 'CODE_ALREADY_REDEEMED';
const CODE_EXPIRED = 'CODE_EXPIRED';

// --- Zod input schema -----------------------------------------------------
export const ConfirmRedemptionInput = z.object({
  redemptionCode: z.string().min(1)
});
export type ConfirmRedemptionInput = z.infer<typeof ConfirmRedemptionInput>;

// --- Result type (matches API-CONTRACT F3 POST /staff/redeem/confirm) -----
export interface ConfirmRedemptionResult {
  status: 'REDEEMED';
  redeemedAt: Date;
}

// --- Usecase --------------------------------------------------------------
export async function confirmRedemption(
  input: unknown
): Promise<ConfirmRedemptionResult> {
  const data = ConfirmRedemptionInput.parse(input);

  // 1) Locate the redemption ledger entry. redemptionCode is @unique so a
  //    findUnique is precise; a referral bonus row never has one.
  const reward = await prisma.reward.findUnique({
    where: { redemptionCode: data.redemptionCode }
  });

  if (!reward || reward.type !== REWARD_TYPE.REDEMPTION) {
    // WHY: treat a code that exists but is not a REDEMPTION as not-found —
    // the client asked about a redemption and we have none. Surfacing a
    // different error would leak the existence of unrelated rows.
    throw new NotFoundError(
      `Redemption code "${data.redemptionCode}" not found`,
      CODE_NOT_FOUND
    );
  }

  // 2) Already redeemed — nothing to do. 409 per API-CONTRACT.
  if (reward.status === REWARD_STATUS.REDEEMED) {
    throw new ConflictError(
      'Redemption code already redeemed',
      CODE_ALREADY_REDEEMED
    );
  }

  // 3) Deadline passed (or already marked EXPIRED). Lazily flip the status
  //    the first time we observe the lapse, matching the referral pattern
  //    in recordPosVisit.ts — no cron needed for the MVP.
  const now = new Date();
  if (
    reward.status === REWARD_STATUS.EXPIRED ||
    (reward.expiresAt !== null && reward.expiresAt < now)
  ) {
    if (reward.status !== REWARD_STATUS.EXPIRED) {
      await prisma.reward.update({
        where: { id: reward.id },
        data: { status: REWARD_STATUS.EXPIRED }
      });
    }
    throw new GoneError(
      'Redemption code has expired',
      CODE_EXPIRED
    );
  }

  // 4) Optimistic lock: only transition ISSUED → REDEEMED. A concurrent
  //    confirm wins the race and the loser sees count=0.
  const updated = await prisma.reward.updateMany({
    where: {
      redemptionCode: data.redemptionCode,
      status: REWARD_STATUS.ISSUED
    },
    data: {
      status: REWARD_STATUS.REDEEMED,
      redeemedAt: now
    }
  });

  if (updated.count === 0) {
    // WHY: the row existed at step 1 but transitioned out of ISSUED before
    // our update ran. Report the same conflict the client would see in the
    // sequential case — no leaking of which exact concurrent path occurred.
    throw new ConflictError(
      'Redemption code already redeemed',
      CODE_ALREADY_REDEEMED
    );
  }

  return { status: 'REDEEMED', redeemedAt: now };
}
