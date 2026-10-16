/**
 * FILE: backend/src/usecases/registerCustomer.ts
 * PURPOSE: Registers a new Customer with a unique referral code. Exports the
 *          shared createCustomerInTx helper so other usecases (e.g. F2a
 *          referral creation) can insert a customer inside their own tx with
 *          identical codegen + collision-retry behavior.
 * CALLED BY: backend/src/routes/customers.ts,
 *            backend/src/usecases/createReferral.ts.
 * CALLS: backend/src/db/prisma.ts, backend/src/errors.ts, @prisma/client, zod.
 */
import { randomInt } from 'node:crypto';
import { Prisma, type Customer } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { ConflictError, InternalError } from '../errors.js';
import { NAME_MAX_LENGTH, PHONE_REGEX } from '../constants.js';

// --- Named constants (no magic numbers) -----------------------------------
const REFERRAL_CODE_RANDOM_LENGTH = 4;
const MAX_CODE_RETRY = 5;
const PREFIX_MAX_LENGTH = 5;
const PREFIX_FALLBACK = 'USER';
const MIN_NAME_LENGTH_FOR_PREFIX = 3;
// WHY: uppercase A-Z + digits — human-readable. Intentionally kept simple;
// excluding look-alikes (0/O, 1/I) can come later if ops asks.
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// --- API-CONTRACT F1 error codes ------------------------------------------
// WHY: named constants — the route/tests reference the same strings, and a
// rename surfaces at compile time instead of drifting silently.
const CODE_EMAIL_EXISTS = 'EMAIL_EXISTS';
const CODE_PHONE_EXISTS = 'PHONE_EXISTS';

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
// WHY: accepts a single field OR a composite key (e.g. ['referralId','type'])
// because Prisma reports composite unique violations as a field array in
// meta.target. All requested fields must be present for a match — that keeps
// the check strict when callers want to distinguish referrals from rewards.
export function isPrismaUniqueViolation(
  err: unknown,
  fields: string | readonly string[]
): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  if (!Array.isArray(target)) return false;
  const wanted = Array.isArray(fields) ? fields : [fields];
  return wanted.every((f) => target.includes(f));
}

// --- Zod input schema -----------------------------------------------------
// WHY: single source of truth for input validation. Route passes raw body
// here; ZodError bubbles up and the global handler maps it to 400 + details.
export const RegisterCustomerInput = z.object({
  email: z.string().email(),
  phone: z.string().regex(PHONE_REGEX, 'Phone must be 10 digits'),
  name: z.string().min(1).max(NAME_MAX_LENGTH)
});
export type RegisterCustomerInput = z.infer<typeof RegisterCustomerInput>;

// --- Shared customer-create helper ----------------------------------------
// WHY exported: createReferral (F2a) inserts the referee inside its own
// transaction and must reuse the exact same codegen + retry policy. Passing
// `tx` in keeps a single source of truth for collision handling, and lets
// the caller decide the atomicity boundary (its own tx) instead of us
// imposing one here.
// WHY: caller-specific codes let one physical operation (create a customer)
// emit different API-CONTRACT codes depending on the endpoint's context.
// F1 passes EMAIL_EXISTS/PHONE_EXISTS; F2a passes REFEREE_*_EXISTS so clients
// can distinguish "referee email taken" from a generic conflict.
export interface CustomerCreateErrorCodes {
  emailExists?: string;
  phoneExists?: string;
}

export async function createCustomerInTx(
  tx: Prisma.TransactionClient,
  data: RegisterCustomerInput,
  errorCodes: CustomerCreateErrorCodes = {}
): Promise<Customer> {
  // WHY: retry on referral-code collisions only. email/phone conflicts are
  // definitive (409) and must not be retried. Attempts are capped so a
  // pathological code-generation bug cannot spin forever.
  for (let attempt = 0; attempt < MAX_CODE_RETRY; attempt++) {
    try {
      return await tx.customer.create({
        data: {
          email: data.email,
          phone: data.phone,
          name: data.name,
          referralCode: generateReferralCode(data.name)
        }
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err, 'email')) {
        throw new ConflictError('Email already registered', errorCodes.emailExists);
      }
      if (isPrismaUniqueViolation(err, 'phone')) {
        throw new ConflictError('Phone already registered', errorCodes.phoneExists);
      }
      if (isPrismaUniqueViolation(err, 'referralCode')) {
        // continue → regenerate code on next loop iteration
        continue;
      }
      throw err;
    }
  }
  throw new InternalError('Failed to generate a unique referral code');
}

// --- Public usecase (F1) --------------------------------------------------
export async function registerCustomer(input: unknown): Promise<Customer> {
  const data = RegisterCustomerInput.parse(input);
  // WHY: pass the PrismaClient as the tx argument. PrismaClient is a
  // structural superset of Prisma.TransactionClient, so a single-insert path
  // and a multi-insert tx path share one implementation.
  // WHY: pass the F1 code overrides — API-CONTRACT documents EMAIL_EXISTS /
  // PHONE_EXISTS here, not the generic CONFLICT the helper defaults to.
  return createCustomerInTx(prisma, data, {
    emailExists: CODE_EMAIL_EXISTS,
    phoneExists: CODE_PHONE_EXISTS
  });
}
