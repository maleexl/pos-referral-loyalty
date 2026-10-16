/**
 * FILE: backend/src/auth/apiKey.ts
 * PURPOSE: Shared API-key helpers for the staff/admin plugins. Reads a required
 *          key from env at plugin registration (fail-fast) and compares a
 *          provided header value against it in constant time, so a network
 *          attacker cannot learn the key byte-by-byte from response timing.
 * CALLED BY: backend/src/routes/staff.ts, backend/src/routes/admin.ts.
 * CALLS: node:crypto (timingSafeEqual), backend/src/errors.ts.
 */
import { timingSafeEqual } from 'node:crypto';
import { InternalError } from '../errors.js';

// WHY: read once at plugin registration. If the key is missing, failing the
// whole startup is better than silently accepting an empty header match.
export function readApiKey(envName: string): string {
  const key = process.env[envName];
  if (!key || key.length === 0) {
    throw new InternalError(`${envName} is not configured`);
  }
  return key;
}

// WHY: timingSafeEqual throws when the buffers differ in length, which would
// turn a wrong-length guess into a 500 instead of a 401. The length pre-check
// short-circuits that case; it does reveal the key's byte length, but length
// is not secret material and the audited recommendation accepts this tradeoff
// (constant-time comparison of the contents is what matters).
export function isValidApiKey(provided: unknown, expected: string): boolean {
  // WHY: headers are string | string[] | undefined. A well-behaved client sends
  // a single value; reject arrays/undefined before touching crypto.
  if (typeof provided !== 'string') return false;
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
