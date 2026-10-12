/**
 * FILE: backend/src/usecases/registerCustomer.ts
 * PURPOSE: Registers a new Customer with a unique referral code. Validates
 *          input with zod, generates a human-readable code from the name,
 *          and retries on referral-code collision (DB-enforced uniqueness).
 * CALLED BY: backend/src/routes/customers.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/errors.ts, @prisma/client, zod.
 */
import { randomInt } from 'node:crypto';
import { Prisma, type Customer } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { ConflictError, InternalError } from '../errors.js';

// --- Named constants (no magic numbers) -----------------------------------
// WHY: all referral-code shape and retry limits are named so they can be
// audited in one place and referenced from tests without duplication.
const REFERRAL_CODE_RANDOM_LENGTH = 4;
const MAX_CODE_RETRY = 5;
const PREFIX_MAX_LENGTH = 5;
const PREFIX_FALLBACK = 'USER';
const MIN_NAME_LENGTH_FOR_PREFIX = 3;
// WHY: uppercase A-Z + digits — human-readable. Intentionally kept simple;
// excluding look-alikes (0/O, 1/I) can come later if ops asks.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const NAME_MAX_LENGTH = 100;
// WHY: Thai mobile numbers are exactly 10 digits, no spaces/dashes. Anything
// else is rejected upstream so the DB stores uniform data.
const PHONE_REGEX = /^\d{10}$/;

// --- Referral-code generation ---------------------------------------------
function extractPrefix(name: string): string {
  // WHY: uppercase + keep only A-Z0-9. Names in Thai/CJK produce an empty
  // string after the filter, so we fall back to a neutral prefix instead of
  // emitting a code that starts with punctuation or digits.
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length < MIN_NAME_LENGTH_FOR_PREFIX) return PREFIX_FALLBACK;
  return cleaned.slice(0, PREFIX_MAX_LENGTH);
}

function generateReferralCode(name: string): string {
  let suffix = '';
  // WHY: randomInt (node:crypto) — no external dep, uniform distribution.
  for (let i = 0; i < REFERRAL_CODE_RANDOM_LENGTH; i++) {
    suffix += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return extractPrefix(name) + suffix;
}

// --- Prisma unique-violation detector -------------------------------------
// WHY: on P2002 we must distinguish WHICH field collided. Retrying on an
// email/phone collision would loop forever — those are hard 409s, not retries.
function isPrismaUniqueViolation(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  // Prisma puts the violated column(s) in meta.target (string[] in Postgres).
  const target = err.meta?.target;
  return Array.isArray(target) && target.includes(field);
}

// --- Input schema ---------------------------------------------------------
// WHY: single source of truth for input validation. Route passes raw body
// here; ZodError bubbles up and the global handler maps it to 400 + details.
const RegisterCustomerInput = z.object({
  email: z.string().email(),
  phone: z.string().regex(PHONE_REGEX, 'Phone must be 10 digits'),
  name: z.string().min(1).max(NAME_MAX_LENGTH)
});
export type RegisterCustomerInput = z.infer<typeof RegisterCustomerInput>;

// --- Usecase --------------------------------------------------------------
export async function registerCustomer(input: unknown): Promise<Customer> {
  const data = RegisterCustomerInput.parse(input);

  // WHY: retry on referral-code collisions only. email/phone conflicts are
  // definitive (409) and must not be retried. Attempts are capped so a
  // pathological code-generation bug cannot spin forever.
  for (let attempt = 0; attempt < MAX_CODE_RETRY; attempt++) {
    try {
      return await prisma.customer.create({
        data: {
          email: data.email,
          phone: data.phone,
          name: data.name,
          referralCode: generateReferralCode(data.name)
        }
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err, 'email')) {
        throw new ConflictError('Email already registered');
      }
      if (isPrismaUniqueViolation(err, 'phone')) {
        throw new ConflictError('Phone already registered');
      }
      if (isPrismaUniqueViolation(err, 'referralCode')) {
        // WHY: continue → regenerate code on next loop iteration.
        continue;
      }
      throw err;
    }
  }

  // WHY: only reached when all MAX_CODE_RETRY attempts collided. Treat as a
  // server-side failure (500) — the client did nothing wrong.
  throw new InternalError('Failed to generate a unique referral code');
}
