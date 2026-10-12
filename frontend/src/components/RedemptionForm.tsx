/**
 * FILE: frontend/src/components/RedemptionForm.tsx
 * PURPOSE: Staff issues a redemption on behalf of a looked-up customer
 *          (POST /staff/redeem). On success shows the redemption code,
 *          the points remaining, and the expiry so the staff can read
 *          them to the customer.
 * CALLED BY: src/pages/Staff.tsx.
 * CALLS: src/hooks/useMutation.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useState, type FormEvent } from 'react';
import { useMutation } from '../hooks/useMutation.js';
import type {
  Customer,
  StaffRedeemInput,
  StaffRedeemResponse
} from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

interface RedemptionFormProps {
  // WHY: the customer is resolved by CustomerLookup before this form can
  // submit — the form only needs the code to send to /staff/redeem. Passing
  // the full Customer would give this component display data it does not
  // use, so we narrow to the one field we need.
  customer: Customer;
  // WHY: staff key is owned by the page (it lives in React state so a 401
  // can reset it). The form forwards it as a header, never persists it.
  staffKey: string;
  // WHY: parent gets the ApiError so it can branch on 401 (clear key) and
  // on 400 INSUFFICIENT_POINTS (optional UI hint in a future sprint).
  onError: (error: unknown) => void;
}

export default function RedemptionForm({
  customer,
  staffKey,
  onError
}: RedemptionFormProps) {
  // WHY: points is a string in state so an empty input is representable —
  // an empty <input type="number"> yields '' not NaN, and coercing early
  // would make the field impossible to clear.
  const [points, setPoints] = useState('');

  const { run, loading, error, data } = useMutation<
    StaffRedeemInput,
    StaffRedeemResponse
  >({
    method: 'POST',
    path: '/staff/redeem',
    auth: { staffKey }
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(points);
    // WHY: the server is the authority on what is a valid points value —
    // we only refuse the obviously-empty / non-positive case client-side to
    // save a round-trip. Integer check is included because points are whole
    // units (settings schema in backend/src/settings/schema.ts).
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return;
    }
    try {
      await run({ customerCode: customer.referralCode, points: parsed });
    } catch (err) {
      onError(err);
    }
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">Issue redemption</h2>
        <p className="text-sm text-gray-600">
          Redeem points for{' '}
          <span className="font-medium">{customer.name}</span>{' '}
          (balance {customer.pointsBalance}).
        </p>
      </header>

      <form
        data-testid="redeem-form"
        onSubmit={handleSubmit}
        className="space-y-3 max-w-sm"
      >
        <div className="space-y-1">
          <label
            htmlFor="redeem-points-input"
            className="block text-sm font-medium"
          >
            Points to redeem
          </label>
          <input
            id="redeem-points-input"
            data-testid="redeem-points-input"
            type="number"
            min={1}
            step={1}
            required
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          data-testid="redeem-submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Issuing…' : 'Issue redemption'}
        </button>
      </form>

      <ErrorBanner error={error} />

      {data && (
        <div className="rounded border border-green-200 bg-green-50 p-4 space-y-1 text-sm text-green-900">
          <div>
            Redemption code:{' '}
            <code
              data-testid="redemption-code"
              className="font-mono font-semibold"
            >
              {data.redemptionCode}
            </code>
          </div>
          <div>
            Points used: <span className="font-semibold">{data.pointsUsed}</span>
          </div>
          <div>
            Points remaining:{' '}
            <span
              data-testid="redemption-remaining"
              className="font-semibold"
            >
              {data.pointsRemaining}
            </span>
          </div>
          <div className="text-xs text-green-800">
            Expires: {data.expiresAt}
          </div>
        </div>
      )}
    </section>
  );
}
