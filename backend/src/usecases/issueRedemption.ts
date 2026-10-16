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
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { settings } from '../settings/loader.js';
import {
  InternalError,
  NotFoundError,
  ValidationError
} from '../errors.js';
import { isPrismaUniqueViolation } from './registerCustomer.js';
import { computePointsBalance } from './listCustomerRewards.js';
import {
  MS_PER_DAY,
  REWARD_STATUS,
  REWARD_TYPE
} from '../constants.js';

// --- Named constants ------------------------------------------------------
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
// WHY: bounded serialization-retry budget (AUD-003 / KI-04). Under SERIALIZABLE
// two concurrent issues that read the same balance cannot both commit; the
// loser gets Prisma P2034. Re-running the transaction makes it re-read the
// now-committed balance, so it usually ends with the ordinary business error
// (INSUFFICIENT_POINTS). The cap prevents a retry storm on a hot row.
const MAX_SERIALIZATION_RETRY = 3;

// --- API-CONTRACT F3 error codes ------------------------------------------
const CODE_CUSTOMER_NOT_FOUND = 'CUSTOMER_NOT_FOUND';
const CODE_INSUFFICIENT_POINTS = 'INSUFFICIENT_POINTS';
// WHY: emitted only if every serializable attempt loses the race. Should be
// vanishingly rare; a typed 500 keeps a raw P2034 from leaking as a generic
// INTERNAL and makes the fail-closed overspend guard visible in logs.
const CODE_REDEMPTION_SERIALIZATION_FAILED = 'REDEMPTION_SERIALIZATION_FAILED';

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

// --- Prisma serialization-failure detector --------------------------------
// WHY: P2034 = "Transaction failed due to a write conflict or a deadlock"
// (Postgres SQLSTATE 40001/40P01). Under SERIALIZABLE this is how Postgres
// tells the losing side of a write skew to retry. Mirrors the detection style
// of isPrismaUniqueViolation so both Prisma-error helpers read the same.
function isPrismaSerializationFailure(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034'
  );
}

// WHY: run the balance-check + negative insert at SERIALIZABLE and rerun the
// WHOLE transaction on a write conflict. A retried attempt re-reads the
// now-committed balance, so the losing request normally finishes with the
// ordinary business error (e.g. INSUFFICIENT_POINTS) instead of overspending.
// On budget exhaustion we fail closed with a typed 500 — never a raw P2034.
async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRY; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err) {
      // WHY: only a write conflict is retryable — business/validation errors
      // (e.g. INSUFFICIENT_POINTS) and unique violations must propagate now.
      if (!isPrismaSerializationFailure(err)) throw err;
      // Otherwise fall through and retry while the budget lasts.
    }
  }
  throw new InternalError(
    'Redemption transaction could not be serialized after retries',
    CODE_REDEMPTION_SERIALIZATION_FAILED
  );
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
    throw new NotFoundError(
      `Customer with code "${data.customerCode}" not found`,
      CODE_CUSTOMER_NOT_FOUND
    );
  }

  // 2) Snapshot business config at issue time (BR-6): code length and expiry
  //    are tunable via settings, but the value baked into this row must not
  //    shift later when an admin edits settings.
  const [codeLength, expiryDays] = await Promise.all([
    settings.getRewardCodeLength(),
    settings.getRedemptionExpiryDays()
  ]);
  const expiresAt = new Date(Date.now() + expiryDays * MS_PER_DAY);

  // 3) Balance read + negative ledger insert in ONE SERIALIZABLE transaction
  //    (AUD-003 / KI-04). WHY SERIALIZABLE: under the old READ COMMITTED
  //    default two concurrent issues could both read the same pre-spend
  //    balance and each insert (write skew) → overspend. SERIALIZABLE makes
  //    Postgres abort the loser with a serialization failure (P2034), and the
  //    bounded retry reruns the transaction so it re-reads the now-committed
  //    balance and ends with the ordinary business error (INSUFFICIENT_POINTS).
  const issueInTx = async (tx: Prisma.TransactionClient) => {
    // Current balance via the shared helper (SAME active-ledger filter as
    // listCustomerRewards — EXPIRED rows are excluded so a lapsed redemption
    // does not silently reduce the balance forever). Passing `tx` keeps the
    // read inside this SERIALIZABLE transaction.
    const balance = await computePointsBalance(customer.id, tx);

    if (balance < data.points) {
      // WHY: 400 per API-CONTRACT — this is a client-actionable rejection,
      // not a server fault. The specific code distinguishes it from generic
      // validation failures on other fields.
      throw new ValidationError(
        `Insufficient points: balance ${balance}, requested ${data.points}`,
        CODE_INSUFFICIENT_POINTS
      );
    }

    // Insert the ledger entry. Points are NEGATIVE — the money has already
    // been "spent" from the customer's perspective; confirmation only marks
    // the redemption as fulfilled at the counter.
    const created = await tx.reward.create({
      data: {
        customerId: customer.id,
        type: REWARD_TYPE.REDEMPTION,
        points: -data.points,
        status: REWARD_STATUS.ISSUED,
        redemptionCode: generateRedemptionCode(codeLength),
        expiresAt
      }
    });
    return { reward: created, currentBalance: balance };
  };

  // WHY the code-collision retry loop wraps the transaction (not the insert):
  // a P2002 aborts the Postgres transaction, so a collided code must be
  // retried by rerunning the whole transaction, not by continuing inside it.
  // P2034 write-conflict retries are handled one layer in, by
  // withSerializableRetry, so they do not consume the code-collision budget.
  for (let attempt = 0; attempt < MAX_CODE_RETRY; attempt++) {
    try {
      const { reward, currentBalance } = await withSerializableRetry(issueInTx);

      // WHY: both fields are written in the create() call above, so a null here
      // means the row was mutated or the schema drifted — a server fault, not
      // a client one. Narrow with a runtime check and fail loudly instead of
      // casting null to a non-null type (AUD-014).
      if (reward.redemptionCode === null || reward.expiresAt === null) {
        throw new InternalError(
          'Redemption row is missing redemptionCode or expiresAt'
        );
      }
      return {
        redemptionCode: reward.redemptionCode,
        pointsUsed: data.points,
        pointsRemaining: currentBalance - data.points,
        expiresAt: reward.expiresAt
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
