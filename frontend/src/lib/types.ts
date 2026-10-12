/**
 * FILE: frontend/src/lib/types.ts
 * PURPOSE: TypeScript shapes mirroring docs/API-CONTRACT.md. Kept manual
 *          (no codegen) so the frontend stays buildable without a backend
 *          running. When the contract changes, this file changes with it.
 * CALLED BY: src/lib/api.ts, hooks, pages.
 * CALLS: (none — type-only module).
 */

// --- Shared envelopes -----------------------------------------------------

// WHY: every error response from the backend uses this exact shape
// (see errors.ts + app.ts setErrorHandler). details is endpoint-specific
// (e.g. F2b 409 carries visitId) so it stays unknown here.
export interface ErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

// WHY: F4 list endpoints share this envelope (referrals, redemptions).
export interface Paginated<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
}

// --- F1 Customer ----------------------------------------------------------

export interface Customer {
  id: string;
  email: string;
  phone: string;
  name: string;
  referralCode: string;
  pointsBalance: number;
  createdAt: string;
}

export interface RegisterCustomerInput {
  email: string;
  phone: string;
  name: string;
}

// --- F2 Referral ----------------------------------------------------------

export type ReferralStatus = 'PENDING' | 'COMPLETED' | 'EXPIRED';

// WHY: shape of the 201 response from POST /api/referrals. The referrer
// receives this when a referee registers with their code. Kept separate
// from CustomerReferralItem because the two are different read models:
// this one is "a referral just created", the other is "my referral list".
export interface ReferralSummary {
  referralId: string;
  status: ReferralStatus;
  createdAt: string;
  expiresAt: string;
  referee: { id: string; referralCode: string };
}

// WHY: row shape of GET /api/customers/:referralCode/referrals. Mirrors
// backend/src/usecases/listCustomerReferrals.ts CustomerReferralItem.
// No `expiresAt` (the backend does not expose it here) and no referrer
// fields (the caller already knows their own code — see the usecase's
// WHY comment). The `completedAt` field is null until the referee visits.
export interface CustomerReferralItem {
  id: string;
  status: ReferralStatus;
  createdAt: string;
  completedAt: string | null;
  referee: {
    id: string;
    name: string;
    referralCode: string;
  };
}

// WHY: the endpoint returns { items } with no pagination metadata — see
// the usecase's WHY comment (bounded per-customer list). Wrapping in
// Paginated<T> would lie about a `total` the API does not send.
export interface CustomerReferralListResponse {
  items: CustomerReferralItem[];
}

export interface CreateReferralInput {
  referrerCode: string;
  refereeEmail: string;
  refereePhone: string;
  refereeName: string;
}

export interface AdminReferralItem {
  id: string;
  status: ReferralStatus;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  referrer: { id: string; name: string; referralCode: string };
  referee: { id: string; name: string; referralCode: string };
}

// --- F3 Rewards -----------------------------------------------------------

export type RewardType = 'REFERRAL_BONUS' | 'REDEMPTION' | 'REFUND';
export type RewardStatus = 'ISSUED' | 'REDEEMED' | 'EXPIRED';

export interface Reward {
  id: string;
  type: RewardType;
  points: number;
  status: RewardStatus;
  createdAt: string;
  redemptionCode?: string;
  expiresAt?: string;
  redeemedAt?: string;
  referralId?: string;
}

export interface ListRewardsResponse {
  pointsBalance: number;
  rewards: Reward[];
}

export interface IssueRedemptionInput {
  customerCode: string;
  points: number;
}

export interface IssueRedemptionResponse {
  redemptionCode: string;
  pointsUsed: number;
  pointsRemaining: number;
  expiresAt: string;
}

export interface ConfirmRedemptionResponse {
  status: 'REDEEMED';
  redeemedAt: string;
}

export interface AdminRedemptionItem {
  id: string;
  customerCode: string;
  points: number;
  code: string | null;
  status: RewardStatus;
  createdAt: string;
  redeemedAt: string | null;
  expiresAt: string | null;
}

// --- F4 Settings ----------------------------------------------------------

// WHY: values are strings on the wire (see docs/API-CONTRACT.md §F4 and
// DECISIONS #4). Consumers parse at the point of use.
export type Settings = Record<string, string>;
export type UpdateSettingsInput = Record<string, string>;
