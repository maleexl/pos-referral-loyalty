/**
 * FILE: frontend/src/pages/Customer.tsx
 * PURPOSE: Customer page (F1 + F2a). Reads the persisted referralCode from
 *          localStorage on mount. If none, shows the register form; if
 *          present, looks the customer up and renders the referral card +
 *          referee invite form. A 404 on lookup means the stored code is
 *          stale (dev DB reset) — clear it and fall back to registration.
 * CALLED BY: frontend/src/App.tsx (route /customer).
 * CALLS: src/components/{RegisterForm,ReferralCard,RefereeForm,ErrorBanner}.tsx,
 *        src/hooks/useApi.ts, src/lib/storage.ts, src/lib/types.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import RegisterForm from '../components/RegisterForm.js';
import ReferralCard from '../components/ReferralCard.js';
import RefereeForm from '../components/RefereeForm.js';
import ErrorBanner from '../components/ErrorBanner.js';
import { useApi } from '../hooks/useApi.js';
import {
  clearStoredReferralCode,
  getStoredReferralCode
} from '../lib/storage.js';
import type { Customer } from '../lib/types.js';

// WHY: split out because useApi always fires on mount — we only want the
// GET to run when a code actually exists. This component is mounted
// conditionally by CustomerPage so the hook's lifecycle matches "have a
// code to look up". Keeps the page component free of effect-only plumbing.
function CustomerView({
  referralCode,
  onInvalidCode
}: {
  referralCode: string;
  onInvalidCode: () => void;
}) {
  const customer = useApi<Customer>(`/api/customers/${referralCode}`);

  // WHY: bumping this counter re-runs ReferralCard's list fetch without a
  // page reload after a referee registers. Local to the view — the page
  // does not need to know about the card's refresh cycle.
  const [refreshKey, setRefreshKey] = useState(0);

  // WHY: 404 means the persisted code is stale — clear it and drop back to
  // the register form. Any other error is transient (network, 500) and
  // stays on screen so the user can retry without losing their place.
  useEffect(() => {
    if (customer.error?.status === 404) {
      onInvalidCode();
    }
  }, [customer.error, onInvalidCode]);

  if (customer.loading) {
    return <p className="text-sm text-gray-600">Loading your account…</p>;
  }

  if (customer.error && customer.error.status !== 404) {
    return <ErrorBanner error={customer.error} />;
  }

  // WHY: null here means the 404 effect above has fired but the parent has
  // not yet re-rendered CustomerPage into the register branch. Rendering
  // nothing for one tick is preferable to a flash of stale UI.
  if (!customer.data) return null;

  return (
    <div className="space-y-6">
      <ReferralCard customer={customer.data} refreshKey={refreshKey} />
      <RefereeForm
        referrerCode={customer.data.referralCode}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

export default function CustomerPage() {
  // WHY: lazy initializer reads storage once on mount. Subsequent renders
  // read the state, not storage — so registration changes flow through
  // setCode and the page never has to re-query localStorage.
  const [code, setCode] = useState<string | null>(() =>
    getStoredReferralCode()
  );

  // WHY: stable callbacks so the 404 effect inside CustomerView does not
  // re-fire on every parent render — the effect depends on onInvalidCode.
  const handleRegistered = useCallback((customer: Customer) => {
    setCode(customer.referralCode);
  }, []);

  const handleInvalidCode = useCallback(() => {
    clearStoredReferralCode();
    setCode(null);
  }, []);

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold">Customer</h1>

      {code === null ? (
        <RegisterForm onSuccess={handleRegistered} />
      ) : (
        <CustomerView
          referralCode={code}
          onInvalidCode={handleInvalidCode}
        />
      )}
    </section>
  );
}
