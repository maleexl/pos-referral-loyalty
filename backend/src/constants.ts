/**
 * FILE: backend/src/constants.ts
 * PURPOSE: Central enum-like constants for domain statuses. Re-exports
 *          Prisma's generated enums under SCREAMING_SNAKE aliases so internal
 *          code and tests read consistently without duplicating the literal
 *          values (which would drift from the DB schema).
 * CALLED BY: usecases (recordPosVisit, createReferral), routes, tests.
 * CALLS: @prisma/client (generated enums).
 */
import {
  ReferralStatus,
  RewardStatus,
  RewardType
} from '@prisma/client';

// WHY: re-export rather than redefine. Prisma emits each enum as
// `{ PENDING: 'PENDING', ... } as const` — the values are guaranteed to match
// the DB. A hand-written duplicate would silently rot the moment the schema
// gains a new value.
export const REFERRAL_STATUS = ReferralStatus;
export const REWARD_TYPE = RewardType;
export const REWARD_STATUS = RewardStatus;

// WHY: re-export the types too — lets callers write `type X = ReferralStatus`
// without a second import from @prisma/client.
export type {
  ReferralStatus,
  RewardType,
  RewardStatus
};
