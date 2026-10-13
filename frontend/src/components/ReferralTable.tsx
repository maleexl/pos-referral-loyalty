/**
 * FILE: frontend/src/components/ReferralTable.tsx
 * PURPOSE: Admin referrals table (F4). Server-side status filter +
 *          pagination. The status dropdown is a query param — we do NOT
 *          filter client-side because the server paginates; filtering
 *          locally would only hide rows on the current page, not the
 *          full result set.
 * CALLED BY: src/pages/Admin.tsx.
 * CALLS: src/hooks/useApi.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import type {
  AdminReferralItem,
  Paginated,
  ReferralStatus
} from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

// WHY: matches the backend default (see API-CONTRACT §F4). Kept here as a
// named const so the page size can be tuned in one place if the API
// default ever changes.
const LIMIT = 20;

// WHY: sentinel value for "no filter" — kept separate from ReferralStatus
// so the type stays a closed union of the three real statuses.
const ALL_STATUSES = 'ALL' as const;
type StatusFilter = typeof ALL_STATUSES | ReferralStatus;

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: ALL_STATUSES, label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'EXPIRED', label: 'Expired' }
];

interface ReferralTableProps {
  adminKey: string;
  // WHY: parent owns 401 handling so a stale key resets the whole page.
  onError: (error: unknown) => void;
}

export default function ReferralTable({
  adminKey,
  onError
}: ReferralTableProps) {
  const [status, setStatus] = useState<StatusFilter>(ALL_STATUSES);
  const [page, setPage] = useState(1);

  // WHY: build the query string explicitly (not URLSearchParams) so an
  // omitted status is a truly absent param rather than `status=` empty —
  // the backend treats missing vs empty differently at the validation
  // boundary (see API-CONTRACT §F4: status is optional).
  const query =
    status === ALL_STATUSES
      ? `?page=${page}&limit=${LIMIT}`
      : `?status=${status}&page=${page}&limit=${LIMIT}`;

  const { data, loading, error, refetch } = useApi<Paginated<AdminReferralItem>>(
    `/admin/referrals${query}`,
    { adminKey },
    [status, page]
  );

  // WHY: 401 must bubble up so the page can clear the stored key. Moved
  // out of the render body — calling a parent setState during a child's
  // render is a React anti-pattern (warning + potential loop). useEffect
  // fires after the commit, which is the correct hook point.
  useEffect(() => {
    if (error && error.status === 401) {
      onError(error);
    }
  }, [error, onError]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / LIMIT);

  function handleStatusChange(next: StatusFilter) {
    setStatus(next);
    // WHY: resetting to page 1 on filter change is mandatory — page 5 of
    // the unfiltered list may not exist for the filtered list, and the
    // backend would return an empty page with no obvious cause.
    setPage(1);
  }

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Referrals</h2>
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="referrals-status-filter" className="text-gray-600">
            Status
          </label>
          <select
            id="referrals-status-filter"
            data-testid="referrals-status-filter"
            value={status}
            onChange={(e) => handleStatusChange(e.target.value as StatusFilter)}
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading && (
        <p
          data-testid="referrals-loading"
          className="text-sm text-gray-600"
        >
          Loading referrals…
        </p>
      )}

      <ErrorBanner error={error && error.status !== 401 ? error : null} />

      {!loading && !error && items.length === 0 && (
        <p data-testid="referrals-empty" className="text-sm text-gray-600">
          No referrals match the current filter.
        </p>
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table
              data-testid="referrals-table"
              className="min-w-full text-sm"
            >
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Referee</th>
                  <th className="px-3 py-2 font-medium">Referrer</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((r) => (
                  <tr key={r.id} data-testid="referrals-row">
                    <td className="px-3 py-2">
                      <div>{r.referee.name}</div>
                      <div className="font-mono text-xs text-gray-500">
                        {r.referee.referralCode}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{r.referrer.name}</div>
                      <div className="font-mono text-xs text-gray-500">
                        {r.referrer.referralCode}
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.createdAt}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.completedAt ?? '—'}
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
                data-testid="referrals-prev-page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                data-testid="referrals-next-page"
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
