/**
 * FILE: frontend/src/hooks/useApi.ts
 * PURPOSE: Minimal GET hook — fetch once on mount (and when `deps` change),
 *          expose { data, loading, error, refetch }. No cache layer by
 *          design; see DECISIONS-for-frontend note in the header of
 *          src/lib/api.ts.
 * CALLED BY: src/pages/Customer.tsx and the components that list/fetch:
 *            ReferralCard, CustomerLookup, ReferralTable, RedemptionTable,
 *            SettingsEditor.
 * CALLS: react, src/lib/api.ts.
 *
 * WHY no TanStack Query: the app has ~3 pages and no shared cache
 * requirements. useState + useEffect is easier to explain in a walkthrough
 * and eliminates a runtime dependency for a scope that does not need it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  request,
  type RequestOptions
} from '../lib/api.js';

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  refetch: () => Promise<void>;
}

export function useApi<T>(
  path: string,
  // WHY: optional auth headers passed per call. Pages populate these from
  // localStorage at the point where a staff/admin action is triggered — the
  // hook itself stays auth-agnostic so it can also serve public endpoints.
  options: RequestOptions = {},
  // WHY: deps mirrors useEffect's contract. Callers list values that should
  // re-trigger the fetch; using the array reference is safe because useEffect
  // only compares element values.
  deps: readonly unknown[] = []
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  // WHY: prevent setState-after-unmount warnings when the user navigates
  // away mid-request. React 18+ is quieter about this, but the ref costs
  // nothing and keeps the behavior explicit.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchOnce = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await request<T>(path, { ...options, method: 'GET' });
      if (mountedRef.current) setData(result);
    } catch (err) {
      if (mountedRef.current) {
        setError(
          err instanceof ApiError ? err : new ApiError(0, 'INTERNAL', String(err))
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // WHY: deliberately not depending on `options` — callers pass inline
    // objects that would change identity every render and cause a fetch
    // loop. Provide meaningful triggers via the explicit deps array instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    void fetchOnce();
    // WHY: caller-provided deps gate re-fetching. eslint sees them spread;
    // this is the same trick used by common "refetch when X changes" hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOnce, ...deps]);

  return { data, loading, error, refetch: fetchOnce };
}
