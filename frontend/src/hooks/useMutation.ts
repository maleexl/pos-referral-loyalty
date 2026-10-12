/**
 * FILE: frontend/src/hooks/useMutation.ts
 * PURPOSE: Minimal mutation hook for POST/PATCH/DELETE. Exposes
 *          { run, loading, error, data, reset } — callers invoke run(input)
 *          from event handlers, not on mount.
 * CALLED BY: pages (Customer/Staff/Admin) in Sprint 3.
 * CALLS: react, src/lib/api.ts.
 *
 * WHY a "callback-style" API instead of a per-mutation hook like
 * useRegisterCustomer: the transport layer (path, method, headers) varies
 * per call site, and keeping one generic hook avoids a proliferation of
 * one-line wrappers. The page decides when and how to run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  request,
  type RequestOptions
} from '../lib/api.js';

export interface MutationOptions {
  method: 'POST' | 'PATCH' | 'DELETE';
  // WHY: path may depend on input (e.g. /api/customers/:code/rewards). The
  // hook does not precompute it — the caller's run() gets the final path.
  path: string;
  // WHY: staff/admin keys are read from localStorage by the page and passed
  // through. Keeping them out of the hook body means the hook has no
  // knowledge of auth — it just forwards headers.
  auth?: Pick<RequestOptions, 'staffKey' | 'adminKey'>;
}

export interface UseMutationResult<TInput, TOutput> {
  run: (input: TInput) => Promise<TOutput>;
  loading: boolean;
  error: ApiError | null;
  data: TOutput | null;
  reset: () => void;
}

export function useMutation<TInput, TOutput>(
  opts: MutationOptions
): UseMutationResult<TInput, TOutput> {
  const [data, setData] = useState<TOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Same unmount guard as useApi — see comment there.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (input: TInput): Promise<TOutput> => {
      setLoading(true);
      setError(null);
      try {
        const result = await request<TOutput>(opts.path, {
          method: opts.method,
          body: input,
          ...opts.auth
        });
        if (mountedRef.current) setData(result);
        return result;
      } catch (err) {
        const apiErr =
          err instanceof ApiError ? err : new ApiError(0, 'INTERNAL', String(err));
        if (mountedRef.current) setError(apiErr);
        // WHY: re-throw so the caller can branch on the specific code
        // (e.g. INSUFFICIENT_POINTS) inside a try/catch, while the hook still
        // records it in state for display.
        throw apiErr;
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [opts.path, opts.method, opts.auth]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { run, loading, error, data, reset };
}
