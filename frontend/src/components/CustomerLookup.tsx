/**
 * FILE: frontend/src/components/CustomerLookup.tsx
 * PURPOSE: Staff looks up a customer by referral code, then passes the
 *          resolved Customer up to the page so the redemption form can
 *          reference it. Lookup uses the PUBLIC GET /api/customers/:code
 *          (see API-CONTRACT §F1) — no staff auth required for the read.
 * CALLED BY: src/pages/Staff.tsx.
 * CALLS: src/hooks/useApi.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '../hooks/useApi.js';
import type { Customer } from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

interface CustomerLookupProps {
  // WHY: parent needs the resolved Customer to feed RedemptionForm (it
  // displays name + balance, and needs referralCode as the redeem input).
  // Lifting keeps this component a pure lookup surface.
  onFound: (customer: Customer) => void;
}

export default function CustomerLookup({ onFound }: CustomerLookupProps) {
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    // WHY: empty code would produce a wasted round-trip with 404. Cheap
    // guard keeps the network log clean while the server remains the
    // authoritative validator of the code format/value.
    if (trimmed.length === 0) return;
    setSubmittedCode(trimmed);
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">Customer lookup</h2>
        <p className="text-sm text-gray-600">
          Look up a customer by their referral code.
        </p>
      </header>

      <form
        data-testid="staff-customer-form"
        onSubmit={handleSubmit}
        className="space-y-3 max-w-sm"
      >
        <div className="space-y-1">
          <label
            htmlFor="staff-customer-input"
            className="block text-sm font-medium"
          >
            Customer code
          </label>
          <input
            id="staff-customer-input"
            data-testid="staff-customer-input"
            type="text"
            autoComplete="off"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          data-testid="staff-customer-submit"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Look up
        </button>
      </form>

      {/* WHY: mount the result view only once a code has been submitted —
          useApi always fires on mount, so mounting it unconditionally would
          request /api/customers/ with an empty code and 404 on every load.
          Keying on submittedCode forces a fresh hook instance when the
          staff looks up a different customer. */}
      {submittedCode !== null && (
        <LookupResult
          key={submittedCode}
          code={submittedCode}
          onFound={onFound}
        />
      )}
    </section>
  );
}

function LookupResult({
  code,
  onFound
}: {
  code: string;
  onFound: (customer: Customer) => void;
}) {
  const { data, loading, error } = useApi<Customer>(
    `/api/customers/${code}`
  );

  // WHY: notify the parent once data arrives. useEffect (not direct call in
  // render) so React sees a stable commit before the parent re-renders —
  // avoids "Cannot update during render" warnings.
  useNotifyOnData(data, onFound);

  if (loading) {
    return <p className="text-sm text-gray-600">Loading customer…</p>;
  }

  if (error) {
    return <ErrorBanner error={error} />;
  }

  if (!data) return null;

  return (
    <div className="rounded border border-gray-200 bg-white p-4 space-y-1">
      <div className="text-sm">
        <span className="font-medium">{data.name}</span>
      </div>
      <div className="font-mono text-xs text-gray-500">
        {data.referralCode}
      </div>
      <div className="text-sm text-gray-700">
        Points balance:{' '}
        <span className="font-semibold">{data.pointsBalance}</span>
      </div>
    </div>
  );
}

// WHY: tiny wrapper around useEffect so LookupResult reads linearly. Kept
// out of the main body because the eslint react-hooks rule wants the deps
// list to reference props, and a named helper documents the intent.
function useNotifyOnData(
  data: Customer | null,
  onFound: (customer: Customer) => void
) {
  useEffect(() => {
    if (data) onFound(data);
  }, [data, onFound]);
}
