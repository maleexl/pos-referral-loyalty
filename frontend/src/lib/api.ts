/**
 * FILE: frontend/src/lib/api.ts
 * PURPOSE: Thin fetch wrapper for the backend API. Reads the base URL from
 *          VITE_API_URL, injects optional auth headers, normalizes the
 *          standard error envelope into a typed ApiError, and returns parsed
 *          JSON on success. No caching layer — the app is small and the
 *          custom hooks (useApi/useMutation) handle per-call state.
 * CALLED BY: src/hooks/useApi.ts, src/hooks/useMutation.ts.
 * CALLS: src/lib/types.ts (ErrorResponse), browser fetch.
 */
import type { ErrorResponse } from './types.js';

// WHY: read env at module load. import.meta.env is inlined by Vite at build
// time; a missing VITE_API_URL means the developer forgot to copy
// frontend/.env.example → frontend/.env. Fail fast rather than silently
// hitting a wrong URL.
const BASE_URL = import.meta.env.VITE_API_URL;
if (!BASE_URL) {
  throw new Error(
    'VITE_API_URL is not set. Copy frontend/.env.example to frontend/.env.'
  );
}

// WHY: a client-side error class distinct from the backend's ApiError. Same
// shape (status/code/message/details) so callers write identical handling.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  // WHY: staff/admin keys are entered by the operator and stored in
  // localStorage (see hooks). They are per-request, never baked into the
  // bundle — see docs/DECISIONS.md #5.
  staffKey?: string;
  adminKey?: string;
}

export async function request<T>(
  path: string,
  opts: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.staffKey) headers['X-Staff-Key'] = opts.staffKey;
  if (opts.adminKey) headers['X-Admin-Key'] = opts.adminKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });

  // WHY: 204 has no body. Endpoints that return nothing must not be forced
  // through .json(), which would throw on an empty stream.
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed = text.length > 0 ? JSON.parse(text) : undefined;

  if (!res.ok) {
    // WHY: the backend always emits { error, code, details? } on failure
    // (see backend/src/app.ts setErrorHandler). Fall back gracefully if a
    // proxy or future error path returns something else.
    const err = (parsed ?? {}) as Partial<ErrorResponse>;
    throw new ApiError(
      res.status,
      err.code ?? 'INTERNAL',
      err.error ?? `HTTP ${res.status}`,
      err.details
    );
  }

  return parsed as T;
}
