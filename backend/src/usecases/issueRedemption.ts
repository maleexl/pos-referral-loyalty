/**
 * FILE: backend/src/usecases/issueRedemption.ts
 * PURPOSE: Issues a redemption on behalf of a customer. Creates a signed
 *          negative ledger entry (REDEMPTION) reserving the points and hands
 *          staff a short code the customer can present. Points are only
 *          actually marked REDEEMED after staff confirm (see confirmRedemption).
 * CALLED BY: backend/src/routes/staff.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/settings/loader.ts,
 *        backend/src/constants.ts, backend/src/errors.ts,
 *        backend/src/usecases/registerCustomer.ts (P2002 helper),
 *        @prisma/client, zod.
 */
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { settings } from '../settings/loader.js';
import {
  InternalError,
  NotFoundError,
  ValidationError
} from '../errors.js';
import { isPrismaUniqueViolation } from './registerCustomer.js';
import {
  REWARD_STATUS,
  REWARD_TYPE
} from '../constants.js';

// --- Named constants ------------------------------------------------------
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// WHY: same retry budget as referral-code generation — collisions are rare,
// and a bounded loop keeps a pathological charset/length misconfig from
// spinning forever.
const MAX_CODE_RETRY = 5;
// WHY: drop 0/O and 1/I — staff read the code aloud or type it; look-alike
// characters cause more support tickets than a longer alphabet prevents.
const REDEMPTION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// WHY: guard against a nonsensical settings value (e.g. length 0 would
// generate an empty unique code and collide immediately on row 2).
const MIN_CODE_LENGTH = 4;

// --- API-CONTRACT F3 error code -------------------------------------------
const CODE_INSUFFICIENT_POINTS = 'INSUFFICIENT_POINTS';

// --- Zod input schema -----------------------------------------------------
export const IssueRedemptionInput = z.object({
  customerCode: z.string().min(1),
  // WHY: positive integer only. A redemption of 0 is a no-op that would
  // still mint a code — reject at the boundary instead of in the usecase.
  points: z.number().int().positive()
});
export type IssueRedemptionInput = z.infer<typeof IssueRedemptionInput>;

// --- Result type (matches API-CONTRACT F3 POST /staff/redeem) -------------
export interface IssueRedemptionResult {
  redemptionCode: string;
  pointsUsed: number;
  pointsRemaining: number;
  expiresAt: Date;
}

// --- Code generator -------------------------------------------------------
function generateRedemptionCode(length: number): string {
  if (length < MIN_CODE_LENGTH) {
    throw new InternalError(
      `reward_code_length must be >= ${MIN_CODE_LENGTH} (got ${length})`
    );
  }
  let code = '';
  for (let i = 0; i < length; i++) {
    code += REDEMPTION_CODE_ALPHABET[randomInt(0, REDEMPTION_CODE_ALPHABET.length)];
  }
  return code;
}

// --- Usecase --------------------------------------------------------------
export async function issueRedemption(
  input: unknown
): Promise<IssueRedemptionResult> {
  const data = IssueRedemptionInput.parse(input);

  // 1) Locate the customer. Redemptions are keyed off the customer-facing
  //    referralCode (what staff scans/enters), not the internal id.
  const customer = await prisma.customer.findUnique({
    where: { referralCode: data.customerCode }
  });
  if (!customer) {
    throw new NotFoundError(`Customer with code "${data.customerCode}" not found`);
  }

  // 2) Current balance = SUM(signed points) over active ledger entries.
  //    WHY: same filter as listCustomerRewards — EXPIRED rows are excluded so
  //    a lapsed redemption does not silently reduce the balance forever.
  const aggregate = await prisma.reward.aggregate({
    where: {
      customerId: customer.id,
      status: { in: [REWARD_STATUS.ISSUED, REWARD_STATUS.REDEEMED] }
    },
    _sum: { points: true }
  });
  const currentBalance = aggregate._sum.points ?? 0;

  if (currentBalance < data.points) {
    // WHY: 400 per API-CONTRACT — this is a client-actionable rejection, not
    // a server fault. The specific code distinguishes it from generic
    // validation failures on other fields.
    throw new ValidationError(
      `Insufficient points: balance ${currentBalance}, requested ${data.points}`,
      CODE_INSUFFICIENT_POINTS
    );
  }

  // 3) Snapshot business config at issue time (BR-6): code length and expiry
  //    are tunable via settings, but the value baked into this row must not
  //    shift later when an admin edits settings.
  const [codeLength, expiryDays] = await Promise.all([
    settings.getRewardCodeLength(),
    settings.getRedemptionExpiryDays()
  ]);
  const expiresAt = new Date(Date.now() + expiryDays * MS_PER_DAY);

  // 4) Insert the ledger entry. Points are NEGATIVE — the money has already
  //    been "spent" from the customer's perspective; confirmation only marks
  //    the redemption as fulfilled at the counter.
  //    WHY no wrapping transaction: the balance read above and this insert
  //    are separate statements. Under a single-staff POS workflow, two
  //    concurrent issue calls for the same customer are not realistic. A
  //    future multi-terminal deployment would need SERIALIZABLE isolation
  //    or a balance advisory lock — tracked as known limitation, not fixed
  //    here to keep the MVP simple.
  for (let attempt = 0; attempt < MAX_CODE_RETRY; attempt++) {
    try {
      const reward = await prisma.reward.create({
        data: {
          customerId: customer.id,
          type: REWARD_TYPE.REDEMPTION,
          points: -data.points,
          status: REWARD_STATUS.ISSUED,
          redemptionCode: generateRedemptionCode(codeLength),
          expiresAt
        }
      });
      // Non-null assertions are safe here — we just set both fields.
      return {
        redemptionCode: reward.redemptionCode as string,
        pointsUsed: data.points,
        pointsRemaining: currentBalance - data.points,
        expiresAt: reward.expiresAt as Date
      };
    } catch (err) {
      // WHY: redemptionCode is @unique at DB level — the retry loop catches
      // the P2002 and regenerates. Same pattern as referral codes (F1).
      if (
        isPrismaUniqueViolation(err, 'redemptionCode') &&
        attempt < MAX_CODE_RETRY - 1
      ) {
        continue;
      }
      throw err;
    }
  }

  // Only reached when every attempt collided — a pathological case.
  throw new InternalError('Failed to generate a unique redemption code');
}
