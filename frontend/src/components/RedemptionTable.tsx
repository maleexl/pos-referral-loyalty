/**
 * FILE: frontend/src/components/RedemptionTable.tsx
 * PURPOSE: Admin redemptions table (F4). Server-side pagination only —
 *          the contract does not expose a status filter for this
 *          endpoint (see API-CONTRACT §F4), so the table shows every
 *          redemption row the admin has access to.
 * CALLED BY: src/pages/Admin.tsx.
 * CALLS: src/hooks/useApi.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import type {
  AdminRedemptionItem,
  Paginated
} from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

// WHY: matches the backend default (see API-CONTRACT §F4). Kept here as a
// named const so the page size can be tuned in one place if the API
// default ever changes.
const LIMIT = 20;

interface RedemptionTableProps {
  adminKey: string;
  // WHY: parent owns 401 handling so a stale key resets the whole page.
  onError: (error: unknown) => void;
}

export default function RedemptionTable({
  adminKey,
  onError
}: RedemptionTableProps) {
  const [page, setPage] = useState(1);

  const { data, loading, error, refetch } = useApi<
    Paginated<AdminRedemptionItem>
  >(
    `/admin/redemptions?page=${page}&limit=${LIMIT}`,
    { adminKey },
    [page]
  );

  // WHY: same as ReferralTable — bubbling 401 to the page must happen in
  // an effect, not during render, to avoid a setState-during-render warning.
  useEffect(() => {
    if (error && error.status === 401) {
      onError(error);
    }
  }, [error, onError]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / LIMIT);

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Redemptions</h2>
      </header>

      {loading && (
        <p
          data-testid="redemptions-loading"
          className="text-sm text-gray-600"
        >
          Loading redemptions…
        </p>
      )}

      <ErrorBanner error={error && error.status !== 401 ? error : null} />

      {!loading && !error && items.length === 0 && (
        <p data-testid="redemptions-empty" className="text-sm text-gray-600">
          No redemptions yet.
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table
              data-testid="redemptions-table"
              className="min-w-full text-sm"
            >
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Customer code</th>
                  <th className="px-3 py-2 font-medium">Points</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Redeemed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((r) => (
                  <tr key={r.id} data-testid="redemptions-row">
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.customerCode}
                    </td>
                    <td className="px-3 py-2">{r.points}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.code ?? '—'}
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.createdAt}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.redeemedAt ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-gray-600">
              Page {data?.page ?? page} of {totalPages} — {total} total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="redemptions-prev-page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                data-testid="redemptions-next-page"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
