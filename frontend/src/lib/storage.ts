/**
 * FILE: frontend/src/lib/storage.ts
 * PURPOSE: Typed localStorage helpers for the customer's persisted
 *          referralCode. Keeps the storage key and the read/write logic in
 *          one place so no component reaches into localStorage directly.
 * CALLED BY: src/pages/Customer.tsx, src/components/RegisterForm.tsx.
 * CALLS: (none — browser localStorage).
 */

// WHY: namespaced key avoids collisions with other apps on localhost during
// dev and with any future staff/admin keys the app may persist. The value
// is a plain referralCode string, not JSON — no parse step needed.
export const REFERRAL_CODE_STORAGE_KEY =
  'pos-referral-loyalty.customer.referralCode';

// WHY: localStorage can throw (Safari private mode, quota exhausted, or a
// disabled cookie policy). The page treats a storage miss as "not
// registered" — a thrown exception would crash the mount before the form
// renders, which is worse UX than starting fresh.
export function getStoredReferralCode(): string | null {
  try {
    return window.localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredReferralCode(code: string): void {
  try {
    window.localStorage.setItem(REFERRAL_CODE_STORAGE_KEY, code);
  } catch {
    // WHY: silent by design. Registration already succeeded server-side;
    // losing the local cache means the user re-enters the code on next
    // visit, but the referral itself is not lost — it lives on the server.
  }
}

export function clearStoredReferralCode(): void {
  try {
    window.localStorage.removeItem(REFERRAL_CODE_STORAGE_KEY);
  } catch {
    // WHY: best-effort cleanup. A failed clear means the next mount retries
    // the lookup and clears again on a 404 — self-healing, no user impact.
  }
}

// WHY: staff key is operator-entered, per-browser, and never baked into
// the bundle — see docs/DECISIONS.md #5. Persisting it means a staff member
// does not re-enter it on every reload. Namespaced under the same prefix
// as the customer code so a future cleanup can find both.
export const STAFF_KEY_STORAGE_KEY = 'pos-referral-loyalty.staff.key';

export function getStoredStaffKey(): string | null {
  try {
    return window.localStorage.getItem(STAFF_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredStaffKey(key: string): void {
  try {
    window.localStorage.setItem(STAFF_KEY_STORAGE_KEY, key);
  } catch {
    // WHY: silent — the caller already has the key in memory for this
    // session. Losing the cache just means re-entry next reload.
  }
}

export function clearStoredStaffKey(): void {
  try {
    window.localStorage.removeItem(STAFF_KEY_STORAGE_KEY);
  } catch {
    // WHY: best-effort — a failed clear leaves a stale key that the next
    // 401 will catch and clear again. Self-healing, no user impact.
  }
}
