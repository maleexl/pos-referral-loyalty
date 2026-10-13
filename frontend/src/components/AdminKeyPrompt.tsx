/**
 * FILE: frontend/src/components/AdminKeyPrompt.tsx
 * PURPOSE: One-time prompt for the X-Admin-Key. Persists the key to
 *          localStorage so admin re-entry is only needed on a new device
 *          or after a 401 clears it. No ApiError here — this is client-side
 *          validation of an empty field, so the error is plain text.
 * CALLED BY: src/pages/Admin.tsx.
 * CALLS: src/lib/storage.ts.
 */
import { useState, type FormEvent } from 'react';
import { setStoredAdminKey } from '../lib/storage.js';

interface AdminKeyPromptProps {
  // WHY: parent stores the key in React state for the current session —
  // this component does not own "am I authenticated" because that decision
  // belongs to the page (it needs to reset on 401).
  onAccepted: (key: string) => void;
}

export default function AdminKeyPrompt({ onAccepted }: AdminKeyPromptProps) {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    // WHY: an empty key would produce a 401 from every subsequent call and
    // a worse UX than this one-line guard. The server is the real validator
    // of the key VALUE — we only refuse an obviously-missing one.
    if (trimmed.length === 0) {
      setLocalError('Please enter your admin key.');
      return;
    }
    setLocalError(null);
    setStoredAdminKey(trimmed);
    onAccepted(trimmed);
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">Admin sign-in</h2>
        <p className="text-sm text-gray-600">
          Enter the admin API key. It is stored only in this browser and
          never sent anywhere except the API as a request header.
        </p>
      </header>

      <form
        data-testid="admin-key-form"
        onSubmit={handleSubmit}
        className="space-y-3 max-w-sm"
      >
        <div className="space-y-1">
          <label htmlFor="admin-key-input" className="block text-sm font-medium">
            Admin key
          </label>
          <input
            id="admin-key-input"
            data-testid="admin-key-input"
            // WHY: type=password keeps the key out of shoulder-surfing and
            // out of the browser's autofill suggestions for text inputs.
            // autoComplete=off stops the browser from caching it as a login.
            type="password"
            autoComplete="off"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        {localError && (
          <p className="text-sm text-red-800">{localError}</p>
        )}

        <button
          type="submit"
          data-testid="admin-key-submit"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Continue
        </button>
      </form>
    </section>
  );
}
