/**
 * FILE: backend/prisma/seed.ts
 * PURPOSE: Idempotent seed for the database. Creates default settings rows
 *          and a bootstrap admin Staff record. Safe to run repeatedly.
 * CALLED BY: `npx prisma db seed` (configured in package.json > prisma.seed).
 * CALLS: backend/src/db/prisma.ts, node:crypto, node:process.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';

// WHY: settings keys live here as named constants — the settings loader and
// API contract both reference the same identifiers. If a key is misspelled
// in one place, TS will not catch it (they are strings), but at least the
// source stays discoverable via grep across the codebase.
const SETTINGS_SEED: ReadonlyArray<{ key: string; value: string }> = [
  // Business values — see docs/SPEC.md §5 BR-6 and docs/DECISIONS.md #4.
  { key: 'points_per_referral', value: '100' },
  { key: 'referral_expiry_days', value: '30' },
  { key: 'points_to_thb_rate', value: '1' },
  { key: 'reward_code_length', value: '8' },
  // WHY: redemption code TTL, distinct from referral_expiry_days. SPEC F3
  // says "configurable, default 7 days"; the value lives here so ops can tune
  // it without a redeploy (BR-6).
  { key: 'redemption_expiry_days', value: '7' }
];

// WHY: salt + hash format is `scrypt$N$salt$hash` so the format is self-describing
// and can be upgraded later (e.g. to argon2) without an ambiguous column.
function hashApiKey(rawKey: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(rawKey, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function main(): Promise<void> {
  // --- Settings: upsert so re-running does not duplicate or error ---
  // WHY: `update: {}` on upsert means "if exists, do nothing" — do NOT
  // overwrite an operator's tuned value with the seed default.
  for (const { key, value } of SETTINGS_SEED) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value }
    });
  }
  console.log(`[seed] settings: ${SETTINGS_SEED.length} rows ensured`);

  // --- Bootstrap admin Staff ---
  // WHY: hash of the seed key is the unique handle; if the admin row already
  // exists (same hash), upsert is a no-op. To rotate, change SEED_ADMIN_KEY
  // and re-seed — that creates a NEW Staff row (old one must be deleted
  // manually). This is acceptable for MVP bootstrap, documented in README.
  const seedAdminKey = process.env.SEED_ADMIN_KEY ?? 'change_me_admin';
  const keyHash = hashApiKey(seedAdminKey);

  await prisma.staff.upsert({
    where: { keyHash },
    update: {},
    create: {
      name: 'System Admin',
      keyHash,
      role: 'ADMIN'
    }
  });
  console.log('[seed] staff: bootstrap admin ensured');
}

main()
  .then(() => {
    // WHY: Prisma keeps a connection pool open; without disconnect, the Node
    // process would hang after seeding completes.
    return prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error('[seed] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
