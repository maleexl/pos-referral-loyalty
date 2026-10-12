/**
 * FILE: frontend/src/components/ReferralCard.tsx
 * PURPOSE: Customer dashboard card (F1 + F2a). Shows the customer's
 *          referralCode, points balance, and their referral list. Copy
 *          button writes the code to the clipboard. The list refetches
 *          when the parent bumps `refreshKey` (e.g. after a referee
 *          successfully registers via RefereeForm).
 * CALLED BY: src/pages/Customer.tsx.
 * CALLS: src/hooks/useApi.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import type {
  Customer,
  CustomerReferralListResponse,
  ReferralStatus
} from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

// WHY: single source of truth for badge styling — one lookup instead of
// three inline ternaries at the call site. Keys mirror the ReferralStatus
// union so a new status value fails typecheck here rather than silently
// rendering an unstyled badge.
const STATUS_BADGE_CLASS: Record<ReferralStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-gray-100 text-gray-700'
};

interface ReferralCardProps {
  // WHY: the parent already fetched the customer to validate the persisted
  // code on mount — passing it down avoids a second GET to the same endpoint.
  customer: Customer;
  // WHY: useApi's supported refetch mechanism is its deps array. The parent
  // bumps this counter after a successful referee registration; the hook
  // sees the new value and re-fetches the referral list.
  refreshKey: number;
}

export default function ReferralCard({
  customer,
  refreshKey
}: ReferralCardProps) {
  const [copied, setCopied] = useState(false);

  const list = useApi<CustomerReferralListResponse>(
    `/api/customers/${customer.referralCode}/referrals`,
    {},
    [refreshKey]
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(customer.referralCode);
      setCopied(true);
      // WHY: revert after 2s so the button remains usable for a second
      // copy without a page refresh. Not a critical timer — if the user
      // navigates away first, the setState on unmount is a no-op.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // WHY: clipboard may be denied (permissions, insecure context).
      // Leave `copied` false so the label does not lie. No error banner —
      // the code is visible on screen regardless, so this is cosmetic.
    }
  }

  const items = list.data?.items ?? [];

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Your referral code</h2>
      </header>

      <div className="rounded border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <code
            data-testid="referral-code"
            className="font-mono text-lg tracking-wide"
          >
            {customer.referralCode}
          </code>
          <button
            type="button"
            data-testid="copy-button"
            onClick={handleCopy}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="text-sm text-gray-700">
          Points balance:{' '}
          <span data-testid="points-balance" className="font-semibold">
            {customer.pointsBalance}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-semibold">Referrals</h3>

        {list.loading && (
          <p className="text-sm text-gray-600">Loading referrals…</p>
        )}

        <ErrorBanner error={list.error} />

        {!list.loading && !list.error && items.length === 0 && (
          <p className="text-sm text-gray-600">
            No referrals yet. Share your code to get started.
          </p>
        )}

        {!list.loading && !list.error && items.length > 0 && (
          <ul
            data-testid="referral-list"
            className="divide-y divide-gray-200 rounded border border-gray-200 bg-white"
          >
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {item.referee.name}
                  </div>
                  <div className="truncate font-mono text-xs text-gray-500">
                    {item.referee.referralCode}
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE_CLASS[item.status]}`}
                >
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
