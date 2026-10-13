/**
 * FILE: frontend/src/components/SettingsEditor.tsx
 * PURPOSE: Admin settings editor (F4). Renders one row per key from
 *          GET /admin/settings and saves each key independently via
 *          PATCH /admin/settings. Keys are iterated from the API response
 *          (not hardcoded) so adding a setting server-side surfaces it
 *          here without a frontend change.
 * CALLED BY: src/pages/Admin.tsx.
 * CALLS: src/hooks/useApi.ts, src/hooks/useMutation.ts,
 *        src/components/ErrorBanner.tsx, src/lib/types.ts.
 */
import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api.js';
import { useApi } from '../hooks/useApi.js';
import { useMutation } from '../hooks/useMutation.js';
import type { Settings, UpdateSettingsInput } from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

interface SettingsEditorProps {
  adminKey: string;
  onError: (error: unknown) => void;
}

export default function SettingsEditor({
  adminKey,
  onError
}: SettingsEditorProps) {
  const { data, loading, error, refetch } = useApi<Settings>(
    '/admin/settings',
    { adminKey },
    [adminKey]
  );

  // WHY: drafts holds only keys the user has edited but not yet saved.
  // Display value is `drafts[key] ?? data[key]` — so a refetch after a
  // successful save surfaces the server's new value for untouched keys
  // without clobbering an in-progress edit in a different row.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const { run } = useMutation<UpdateSettingsInput, Settings>({
    method: 'PATCH',
    path: '/admin/settings',
    auth: { adminKey }
  });

  // WHY: bubble 401 to the page (which clears the stored key). Must run in
  // an effect — calling a parent setState during render is a React
  // anti-pattern that produced a lint warning when tried inline.
  useEffect(() => {
    if (error && error.status === 401) {
      onError(error);
    }
  }, [error, onError]);

  async function handleSave(key: string) {
    const value = drafts[key];
    if (value === undefined) return;
    // WHY: client-side check is deliberately minimal — only "is it a
    // number at all". Range and integer-vs-float are the backend's job
    // (backend/src/settings/schema.ts) and come back as OUT_OF_RANGE /
    // INVALID_TYPE, which we display verbatim. Mirroring the ranges here
    // would duplicate the schema and drift.
    if (!Number.isFinite(Number(value))) {
      setSaveError('Value must be a number.');
      setSaveSuccess(null);
      return;
    }

    setSavingKey(key);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      await run({ [key]: value });
      // WHY: drop the draft AFTER a successful save so the input falls back
      // to data[key] — which we refresh below — instead of holding a stale
      // local value.
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSaveSuccess(`Saved "${key}".`);
      void refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onError(err);
      } else if (err instanceof ApiError) {
        // WHY: message verbatim from ApiError — the binding rule.
        setSaveError(err.message);
      } else {
        setSaveError(String(err));
      }
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-600">Loading settings…</p>;
  }

  if (error && error.status !== 401) {
    return <ErrorBanner error={error} />;
  }

  if (!data) return null;

  const keys = Object.keys(data).sort();

  return (
    <section
      data-testid="settings-editor"
      className="space-y-3"
    >
      <header>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-gray-600">
          Edit one value at a time. Ranges and types are enforced by the
          server.
        </p>
      </header>

      <div className="rounded border border-gray-200 bg-white divide-y divide-gray-200">
        {keys.map((key) => {
          const value = drafts[key] ?? data[key] ?? '';
          const isSaving = savingKey === key;
          return (
            <div
              key={key}
              data-testid={`settings-row-${key}`}
              className="flex flex-wrap items-center gap-3 px-3 py-3"
            >
              <label
                htmlFor={`settings-input-${key}`}
                className="min-w-0 flex-1 font-mono text-sm"
              >
                {key}
              </label>
              <input
                id={`settings-input-${key}`}
                data-testid={`settings-input-${key}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={value}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                }
                className="w-32 rounded border border-gray-300 px-2 py-1 font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                data-testid={`settings-save-${key}`}
                onClick={() => void handleSave(key)}
                disabled={isSaving || drafts[key] === undefined}
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          );
        })}
      </div>

      {saveError && (
        <p
          data-testid="settings-error"
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {saveError}
        </p>
      )}

      {saveSuccess && (
        <p
          data-testid="settings-success"
          role="status"
          className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {saveSuccess}
        </p>
      )}
    </section>
  );
}
