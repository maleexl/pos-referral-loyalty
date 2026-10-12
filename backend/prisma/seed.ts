/**
 * FILE: backend/prisma/seed.ts
 * PURPOSE: Idempotent seed for the database. Creates default settings rows
 *          and a bootstrap admin Staff record. Safe to run repeatedly.
 * CALLED BY: `npx prisma db seed` (configured in package.json > prisma.seed).
 * CALLS: backend/src/db/prisma.ts, node:crypto, node:process.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';
import {
  SETTING_KEYS,
  SETTING_SCHEMA
} from '../src/settings/schema.js';

// WHY: settings keys live here as named constants — the settings loader and
// API contract both reference the same identifiers. If a key is misspelled
// in one place, TS will not catch it (they are strings), but at least the
// source stays discoverable via grep across the codebase.
// WHY: derive the seed list from SETTING_SCHEMA (settings/schema.ts) instead
// of duplicating key/default pairs here. That module is the single source of
// truth for tunable business config — its bounds and defaults feed both this
// seed and the PATCH /admin/settings validator, so the two cannot drift.
// See docs/SPEC.md §5 BR-6 and docs/DECISIONS.md #4 for the policy.
const SETTINGS_SEED: ReadonlyArray<{ key: string; value: string }> =
  SETTING_KEYS.map((key) => ({
    key,
    value: SETTING_SCHEMA[key].defaultValue
  }));

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
