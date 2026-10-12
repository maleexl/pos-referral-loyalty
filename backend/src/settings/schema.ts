/**
 * FILE: backend/src/settings/schema.ts
 * PURPOSE: Single source of truth for tunable business settings. Declares each
 *          setting's type, valid range, and seed default. Consumers:
 *            - prisma/seed.ts         (inserts defaults)
 *            - usecases/updateSettings (validates PATCH /admin/settings)
 *            - settings/loader.ts      (typed getters reference the key names)
 * CALLED BY: prisma/seed.ts, backend/src/usecases/updateSettings.ts,
 *            backend/src/settings/loader.ts.
 * CALLS: (none — pure module, no imports).
 */

// WHY: whitelist + per-key bounds. A generic "accept any key/value" endpoint
// would let an admin typo silently disable a feature (e.g. rename
// points_per_referral → point_per_referral), with a confusing 500 from the
// loader later. We fail fast with a specific error code at the admin boundary.
//
// WHY defaultValue is a string: Setting.value is String in the schema. Numeric
// consumers coerce at read time (loader.asInt / asFloat), and the wire format
// for GET/PATCH /admin/settings stays string-typed per API-CONTRACT §F4.
export const SETTING_SCHEMA = {
  // WHY: how many points a referrer earns when their referee completes a first visit.
  points_per_referral: { type: 'int', min: 1, max: 10_000, defaultValue: '100' },
  // WHY: how long a PENDING referral stays valid before it flips to EXPIRED (BR-4).
  referral_expiry_days: { type: 'int', min: 1, max: 365, defaultValue: '30' },
  // WHY: conversion rate applied at display time (points → THB). Future use.
  points_to_thb_rate: { type: 'float', min: 0.01, max: 1000, defaultValue: '1' },
  // WHY: length of a redemption code. Lower bound matches MIN_CODE_LENGTH in
  // issueRedemption.ts; upper bound keeps the code short enough to read aloud.
  reward_code_length: { type: 'int', min: 4, max: 20, defaultValue: '8' },
  // WHY: how long an issued redemption code is valid (SPEC F3, default 7 days).
  redemption_expiry_days: { type: 'int', min: 1, max: 365, defaultValue: '7' }
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMA;
export type SettingSpec = (typeof SETTING_SCHEMA)[SettingKey];

// WHY: derived, not hand-maintained — adding a key above automatically makes
// it part of the whitelist and the seed without touching this file again.
export const SETTING_KEYS = Object.keys(SETTING_SCHEMA) as SettingKey[];

// WHY: narrow type guard for the PATCH validation loop. Kept here (not in the
// usecase) so the whitelist is self-contained — any future consumer that needs
// "is this key allowed?" answers with one import.
export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SCHEMA, key);
}
