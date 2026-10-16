/**
 * FILE: frontend/src/components/ErrorBanner.tsx
 * PURPOSE: Shared error display for async views. Renders nothing when
 *          there is no error, otherwise shows ApiError.message verbatim
 *          per the binding design constraint (no invented copy).
 * CALLED BY: src/pages/Customer.tsx and every async form/table component:
 *            RegisterForm, ReferralCard, RefereeForm, CustomerLookup,
 *            RedemptionForm, ConfirmRedemptionForm, ReferralTable,
 *            RedemptionTable, SettingsEditor.
 * CALLS: src/lib/api.ts (ApiError type).
 */
import type { ApiError } from '../lib/api.js';

interface ErrorBannerProps {
  // WHY: null means "no error" — the component returns null and the caller
  // does not need to guard with {error && <ErrorBanner/>}. Keeps call sites
  // uniform across loading/error/empty branches.
  error: ApiError | null;
}

export default function ErrorBanner({ error }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div
      data-testid="error-banner"
      // WHY: role="alert" announces the error to screen readers without
      // requiring focus — same reason a form-level error belongs here
      // rather than only beside the field that caused it.
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {error.message}
    </div>
  );
}
