/**
 * FILE: backend/src/usecases/updateSettings.ts
 * PURPOSE: Validates and applies a partial update to the settings table.
 *          Whitelists keys, enforces per-key type + bounds from SETTING_SCHEMA,
 *          runs the update in a single transaction, then invalidates the
 *          settings cache so subsequent reads see the new values immediately.
 * CALLED BY: backend/src/routes/admin.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/settings/loader.ts,
 *        backend/src/settings/schema.ts, backend/src/errors.ts, zod.
 */
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { settings } from '../settings/loader.js';
import {
  SETTING_SCHEMA,
  isSettingKey,
  type SettingKey,
  type SettingSpec
} from '../settings/schema.js';
import { ValidationError } from '../errors.js';

// --- API-CONTRACT F4 error codes (PATCH /admin/settings) ------------------
const CODE_UNKNOWN_SETTING_KEY = 'UNKNOWN_SETTING_KEY';
const CODE_INVALID_TYPE = 'INVALID_TYPE';
const CODE_OUT_OF_RANGE = 'OUT_OF_RANGE';

// WHY: PATCH semantics — every field optional, every value a string. The
// settings loader coerces to number at read time (loader.asInt/asFloat), so
// keeping strings on the wire mirrors GET /admin/settings and the DB column.
// The .refine prevents an empty body from being treated as a valid update.
export const UpdateSettingsInput = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one setting must be provided'
  });
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;

// --- Validation -----------------------------------------------------------
// WHY: a single place to normalize + range-check a value per its spec.
// Returning the canonical string form keeps the DB stable (e.g. "100" stays
// "100", not "100.0") and makes string equality comparisons in tests trivial.
function parseValue(key: SettingKey, spec: SettingSpec, raw: string): string {
  if (spec.type === 'int') {
    // WHY: strict regex rejects "1.0", "100abc", " 100", and "" — an integer
    // setting must not silently accept a float that Prisma would truncate.
    if (!/^-?\d+$/.test(raw)) {
      throw new ValidationError(
        `Setting "${key}" expects an integer, got "${raw}"`,
        CODE_INVALID_TYPE
      );
    }
    const n = Number.parseInt(raw, 10);
    if (n < spec.min || n > spec.max) {
      throw new ValidationError(
        `Setting "${key}" must be between ${spec.min} and ${spec.max} (got ${n})`,
        CODE_OUT_OF_RANGE
      );
    }
    return String(n);
  }
  // float
  const n = Number(raw);
  // WHY: Number("") is 0, Number(" 1") is 1, Number("abc") is NaN. The
  // trim-equality guard catches the first two cases where coercion would
  // hide a formatting mistake an operator made in the admin UI.
  if (!Number.isFinite(n) || raw.trim() !== raw || raw === '') {
    throw new ValidationError(
      `Setting "${key}" expects a number, got "${raw}"`,
      CODE_INVALID_TYPE
    );
  }
  if (n < spec.min || n > spec.max) {
    throw new ValidationError(
      `Setting "${key}" must be between ${spec.min} and ${spec.max} (got ${n})`,
      CODE_OUT_OF_RANGE
    );
  }
  return String(n);
}

// --- Usecase --------------------------------------------------------------
export async function updateSettings(
  input: unknown
): Promise<Record<string, string>> {
  const updates = UpdateSettingsInput.parse(input);

  // 1) Validate everything BEFORE touching the DB. A partially-applied update
  //    is worse than a rejected one — the operator may have mixed a valid key
  //    with a typo and needs a clear, atomic "reject all" outcome.
  const normalized: Array<{ key: SettingKey; value: string }> = [];
  for (const [key, raw] of Object.entries(updates)) {
    if (!isSettingKey(key)) {
      throw new ValidationError(
        `Unknown setting key: "${key}"`,
        CODE_UNKNOWN_SETTING_KEY
      );
    }
    const spec = SETTING_SCHEMA[key];
    normalized.push({ key, value: parseValue(key, spec, raw) });
  }

  // 2) Apply in a single transaction. If any row vanished between validate
  //    and update, the whole update rolls back — no half-applied state.
  await prisma.$transaction(
    normalized.map((u) =>
      prisma.setting.update({
        where: { key: u.key },
        data: { value: u.value }
      })
    )
  );

  // 3) Invalidate AFTER commit — never before. If the transaction throws, we
  //    reach no invalidation and the cache stays consistent with the DB.
  //    WHY: admin needs to observe the new value on the very next request;
  //    waiting for TTL expiry would look like the change was lost.
  settings.invalidateCache();

  // 4) Return the full updated map (API-CONTRACT F4: "updated settings object")
  //    so the client can reconcile its entire UI state in one roundtrip.
  return settings.getAll();
}
