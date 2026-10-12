/**
 * FILE: frontend/src/pages/Staff.tsx
 * PURPOSE: Staff page. Three-state flow: (1) key prompt if none stored,
 *          (2) customer lookup, (3) redemption issue + confirm forms.
 *          Any 401 from a staff endpoint clears the stored key and drops
 *          back to the prompt — the server is the authority on key
 *          validity, we do not cache a positive result.
 * CALLED BY: frontend/src/App.tsx (route /staff).
 * CALLS: src/components/{StaffKeyPrompt,CustomerLookup,RedemptionForm,ConfirmRedemptionForm}.tsx,
 *        src/lib/api.ts (ApiError), src/lib/storage.ts, src/lib/types.ts.
 */
import { useCallback, useState } from 'react';
import { ApiError } from '../lib/api.js';
import StaffKeyPrompt from '../components/StaffKeyPrompt.js';
import CustomerLookup from '../components/CustomerLookup.js';
import RedemptionForm from '../components/RedemptionForm.js';
import ConfirmRedemptionForm from '../components/ConfirmRedemptionForm.js';
import {
  clearStoredStaffKey,
  getStoredStaffKey
} from '../lib/storage.js';
import type { Customer } from '../lib/types.js';

export default function StaffPage() {
  // WHY: lazy initializer reads storage once on mount. Subsequent renders
  // use state, so a 401-driven clear flows through setStaffKey — the page
  // never re-queries localStorage during the session.
  const [staffKey, setStaffKey] = useState<string | null>(() =>
    getStoredStaffKey()
  );

  // WHY: the looked-up customer is the input to RedemptionForm. Lifting
  // it here (instead of inside CustomerLookup) lets the redemption form
  // reference the same Customer object without re-fetching it.
  const [customer, setCustomer] = useState<Customer | null>(null);

  // WHY: stable callbacks — CustomerLookup's effect depends on onFound, so
  // an inline arrow would re-run the effect on every parent render and
  // ping-pong setState. The empty dep array gives us one identity for the
  // lifetime of the page.
  const handleFound = useCallback((found: Customer) => {
    setCustomer(found);
  }, []);

  // WHY: single 401 handler for both mutation forms. Clearing the stored
  // key (not just React state) means a reload does not resurrect a stale
  // key that the server has already rejected.
  const handleStaffError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      clearStoredStaffKey();
      setStaffKey(null);
      setCustomer(null);
    }
    // WHY: non-401 errors are shown by the component that owns the
    // mutation (its ErrorBanner reads useMutation.error). Swallowing here
    // avoids duplicate toasts / banners for the same failure.
  }, []);

  if (staffKey === null) {
    return <StaffKeyPrompt onAccepted={setStaffKey} />;
  }

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold">Staff</h1>

      <CustomerLookup onFound={handleFound} />

      {customer !== null && (
        <div className="space-y-6">
          <RedemptionForm
            customer={customer}
            staffKey={staffKey}
            onError={handleStaffError}
          />
          <ConfirmRedemptionForm
            staffKey={staffKey}
            onError={handleStaffError}
          />
        </div>
      )}
    </section>
  );
}
