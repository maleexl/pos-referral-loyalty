/**
 * FILE: backend/src/usecases/createReferral.ts
 * PURPOSE: Creates a PENDING referral by registering the referee as a new
 *          customer and linking them to the referrer. All writes happen in
 *          one Prisma transaction so a partial state cannot survive.
 * CALLED BY: backend/src/routes/referrals.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/settings/loader.ts,
 *        backend/src/usecases/registerCustomer.ts, backend/src/errors.ts,
 *        @prisma/client, zod.
 */
import { ReferralStatus, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { settings } from '../settings/loader.js';
import {
  createCustomerInTx,
  isPrismaUniqueViolation
} from './registerCustomer.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError
} from '../errors.js';

// --- Named constants ------------------------------------------------------
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// WHY: matches the format generateReferralCode produces (prefix 3-5 + 4 random).
// The wider bound (6-10) is deliberately permissive — API clients should not
// have to replicate our exact length rules.
const REFERRER_CODE_REGEX = /^[A-Z0-9]{6,10}$/;
const NAME_MAX_LENGTH = 100;
const PHONE_REGEX = /^\d{10}$/;

// --- API-CONTRACT F2 error codes ------------------------------------------
// WHY: exported as named constants — routes/tests reference the same strings,
// and renaming them surfaces as a compile-time error rather than a silent
// string drift.
const CODE_REFERRER_NOT_FOUND = 'REFERRER_NOT_FOUND';
const CODE_SELF_REFERRAL = 'SELF_REFERRAL';
const CODE_REFEREE_EMAIL_EXISTS = 'REFEREE_EMAIL_EXISTS';
const CODE_REFEREE_PHONE_EXISTS = 'REFEREE_PHONE_EXISTS';
const CODE_REFEREE_HAS_REFERRER = 'REFEREE_HAS_REFERRER';

// --- Zod input schema -----------------------------------------------------
export const CreateReferralInput = z.object({
  referrerCode: z.string().regex(REFERRER_CODE_REGEX, 'Invalid referrer code'),
  refereeEmail: z.string().email(),
  refereePhone: z.string().regex(PHONE_REGEX, 'Phone must be 10 digits'),
  refereeName: z.string().min(1).max(NAME_MAX_LENGTH)
});
export type CreateReferralInput = z.infer<typeof CreateReferralInput>;

// --- Result type (matches API-CONTRACT F2 response) -----------------------
export interface CreateReferralResult {
  referralId: string;
  status: ReferralStatus;
  createdAt: Date;
  expiresAt: Date;
  referee: {
    id: string;
    referralCode: string;
  };
}

function computeExpiresAt(expiryDays: number): Date {
  // WHY: BR-4 — snapshot the deadline at creation time. A later settings
  // change must NOT retroactively move existing referrals' deadlines.
  return new Date(Date.now() + expiryDays * MS_PER_DAY);
}

// --- Usecase --------------------------------------------------------------
export async function createReferral(
  input: unknown
): Promise<CreateReferralResult> {
  const data = CreateReferralInput.parse(input);

  // WHY: read the expiry setting OUTSIDE the transaction. The settings loader
  // may hit the DB (cold cache); keeping it out shortens the tx window and
  // avoids holding a DB connection while doing nothing.
  const expiryDays = await settings.getReferralExpiryDays();

  return prisma.$transaction(async (tx) => {
    // 1) Locate referrer — no writes yet.
    const referrer = await tx.customer.findUnique({
      where: { referralCode: data.referrerCode }
    });
    if (!referrer) {
      throw new NotFoundError(
        `Referrer with code "${data.referrerCode}" not found`,
        CODE_REFERRER_NOT_FOUND
      );
    }

    // 2) Self-referral check BEFORE creating the referee — fail fast.
    // WHY: MVP only guards against reusing the same email/phone. A user could
    // still self-refer with a fresh pair; detecting that needs device
    // fingerprinting, explicitly out of scope (SPEC §7).
    if (
      referrer.email === data.refereeEmail ||
      referrer.phone === data.refereePhone
    ) {
      throw new ForbiddenError('Cannot refer yourself', CODE_SELF_REFERRAL);
    }

    // 3) Detect whether the referee email/phone already belongs to a customer.
    // WHY: referees must be NEW customers (SPEC F2). An existing customer
    // cannot be turned into a referee, so we resolve the collision here — and
    // can emit the documented REFEREE_HAS_REFERRER when that customer is
    // already someone's referee (BR-2 / API-CONTRACT F2). The check-then-write
    // is backed by the DB UNIQUE constraints below as the race fallback.
    const existingByEmail = await tx.customer.findUnique({
      where: { email: data.refereeEmail }
    });
    const existingByPhone = await tx.customer.findUnique({
      where: { phone: data.refereePhone }
    });
    const existingIds = [existingByEmail?.id, existingByPhone?.id].filter(
      (id): id is string => id !== undefined
    );
    if (existingIds.length > 0) {
      const existingReferral = await tx.referral.findFirst({
        where: { refereeId: { in: existingIds } }
      });
      if (existingReferral) {
        throw new ConflictError(
          'Referee already has a referrer',
          CODE_REFEREE_HAS_REFERRER
        );
      }
      // WHY: email wins over phone — matches createCustomerInTx's check order,
      // so a client hitting both collisions sees a stable, predictable code.
      if (existingByEmail) {
        throw new ConflictError(
          'Referee email already registered',
          CODE_REFEREE_EMAIL_EXISTS
        );
      }
      throw new ConflictError(
        'Referee phone already registered',
        CODE_REFEREE_PHONE_EXISTS
      );
    }

    // 4) Create referee — reuses F1 helper for codegen + retry policy.
    const referee = await createCustomerInTx(
      tx,
      {
        email: data.refereeEmail,
        phone: data.refereePhone,
        name: data.refereeName
      },
      {
        emailExists: CODE_REFEREE_EMAIL_EXISTS,
        phoneExists: CODE_REFEREE_PHONE_EXISTS
      }
    );

    // 5) Create referral — see WHY on the defensive catch below.
    try {
      const referral = await tx.referral.create({
        data: {
          referrerId: referrer.id,
          refereeId: referee.id,
          status: ReferralStatus.PENDING,
          expiresAt: computeExpiresAt(expiryDays)
        }
      });

      return {
        referralId: referral.id,
        status: referral.status,
        createdAt: referral.createdAt,
        expiresAt: referral.expiresAt,
        referee: {
          id: referee.id,
          referralCode: referee.referralCode
        }
      };
    } catch (err) {
      // WHY: refereeId has a DB-level UNIQUE constraint (BR-2). The customer
      // we just created has a fresh id, so this should never fire. The catch
      // is defense-in-depth against a hypothetical race with another caller
      // and translates the constraint into the API-CONTRACT code.
      if (isPrismaUniqueViolation(err, 'refereeId')) {
        throw new ConflictError(
          'Referee already has a referrer',
          CODE_REFEREE_HAS_REFERRER
        );
      }
      throw err;
    }
  });
}

// WHY: re-export the Prisma type so future callers do not need a second import
// from @prisma/client just to type the tx. Unused today, but keeps the
// public surface stable if the impl moves.
export type { Prisma };
