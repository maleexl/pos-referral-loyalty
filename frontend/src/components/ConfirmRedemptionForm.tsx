/**
 * FILE: frontend/src/components/ConfirmRedemptionForm.tsx
 * PURPOSE: Staff marks a redemption code as used (POST /staff/redeem/confirm).
 *          Independent of RedemptionForm — staff may confirm later, on the
 *          same visit or a subsequent one, because the code has an expiry.
 * CALLED BY: src/pages/Staff.tsx.
 * CALLS: src/hooks/useMutation.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useState, type FormEvent } from 'react';
import { useMutation } from '../hooks/useMutation.js';
import type {
  StaffConfirmInput,
  StaffConfirmResponse
} from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

interface ConfirmRedemptionFormProps {
  staffKey: string;
  // WHY: same 401-branching rationale as RedemptionForm — the page owns
  // session state, so it must see the error.
  onError: (error: unknown) => void;
}

export default function ConfirmRedemptionForm({
  staffKey,
  onError
}: ConfirmRedemptionFormProps) {
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState<StaffConfirmResponse | null>(
    null
  );

  const { run, loading, error } = useMutation<
    StaffConfirmInput,
    StaffConfirmResponse
  >({
    method: 'POST',
    path: '/staff/redeem/confirm',
    auth: { staffKey }
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    // WHY: empty code would 404; guard to avoid a wasted round-trip.
    if (trimmed.length === 0) return;
    // WHY: clear the previous confirmation before retrying so a stale
    // success does not linger next to an error if this attempt fails.
    setConfirmed(null);
    try {
      const result = await run({ redemptionCode: trimmed });
      setConfirmed(result);
    } catch (err) {
      onError(err);
    }
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">Confirm redemption</h2>
        <p className="text-sm text-gray-600">
          Mark a redemption code as used once the customer has taken the
          goods or discount.
        </p>
      </header>

      <form
        data-testid="redeem-confirm-form"
        onSubmit={handleSubmit}
        className="space-y-3 max-w-sm"
      >
        <div className="space-y-1">
          <label
            htmlFor="redeem-code-input"
            className="block text-sm font-medium"
          >
            Redemption code
          </label>
          <input
            id="redeem-code-input"
            data-testid="redeem-code-input"
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
          data-testid="redeem-confirm-submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Confirming…' : 'Confirm'}
        </button>
      </form>

      <ErrorBanner error={error} />

      {confirmed && (
        <p className="text-sm text-green-800">
          Confirmed at {confirmed.redeemedAt}.
        </p>
      )}
    </section>
  );
}
