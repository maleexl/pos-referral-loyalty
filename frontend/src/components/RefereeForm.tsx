/**
 * FILE: frontend/src/components/RefereeForm.tsx
 * PURPOSE: Referee invite form (F2a). Submits to POST /api/referrals with
 *          the current customer's code as referrerCode, then shows a plain
 *          success message (no email is sent in the MVP).
 * CALLED BY: src/pages/Customer.tsx.
 * CALLS: src/hooks/useMutation.ts, src/components/ErrorBanner.tsx,
 *        src/lib/types.ts.
 */
import { useState, type FormEvent } from 'react';
import { useMutation } from '../hooks/useMutation.js';
import type {
  CreateReferralInput,
  ReferralSummary
} from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

interface RefereeFormProps {
  // WHY: the parent owns the current customer's code — this component does
  // not read storage itself. Same reasoning as RegisterForm's onSuccess:
  // one clear data owner keeps state transitions in a single place.
  referrerCode: string;
  // WHY: parent bumps its refreshKey after success so ReferralCard refetches
  // its list and shows the new referee row immediately, no full page reload.
  onSuccess: () => void;
}

export default function RefereeForm({
  referrerCode,
  onSuccess
}: RefereeFormProps) {
  const [refereeEmail, setRefereeEmail] = useState('');
  const [refereePhone, setRefereePhone] = useState('');
  const [refereeName, setRefereeName] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { run, loading, error, reset } = useMutation<
    CreateReferralInput,
    ReferralSummary
  >({ method: 'POST', path: '/api/referrals' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await run({
        referrerCode,
        refereeEmail,
        refereePhone,
        refereeName
      });
      // WHY: clear the fields before flipping `submitted` so the success
      // view never flashes the previous values behind it during the same
      // render pass.
      setRefereeEmail('');
      setRefereePhone('');
      setRefereeName('');
      setSubmitted(true);
      onSuccess();
    } catch {
      // WHY: same pattern as RegisterForm — useMutation records the
      // ApiError for ErrorBanner to render; nothing else to do here.
    }
  }

  function handleReset() {
    reset();
    setSubmitted(false);
  }

  if (submitted) {
    return (
      <section
        data-testid="referee-success"
        className="space-y-2 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800"
      >
        <p className="font-medium">Invitation sent.</p>
        <p>
          Ask your friend to register with the code{' '}
          <code className="font-mono">{referrerCode}</code>.
        </p>
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-green-300 px-3 py-1 text-xs hover:bg-green-100"
        >
          Invite another friend
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold">Invite a friend</h2>
        <p className="text-sm text-gray-600">
          Your friend will register with your code{' '}
          <code className="font-mono">{referrerCode}</code>.
        </p>
      </header>

      <form
        data-testid="referee-form"
        onSubmit={handleSubmit}
        className="space-y-3 max-w-sm"
      >
        <div className="space-y-1">
          <label
            htmlFor="referee-email"
            className="block text-sm font-medium"
          >
            Friend's email
          </label>
          <input
            id="referee-email"
            data-testid="referee-email"
            type="email"
            autoComplete="email"
            required
            value={refereeEmail}
            onChange={(e) => setRefereeEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="referee-phone"
            className="block text-sm font-medium"
          >
            Friend's phone
          </label>
          <input
            id="referee-phone"
            data-testid="referee-phone"
            type="tel"
            autoComplete="tel"
            required
            value={refereePhone}
            onChange={(e) => setRefereePhone(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="referee-name" className="block text-sm font-medium">
            Friend's name
          </label>
          <input
            id="referee-name"
            data-testid="referee-name"
            type="text"
            autoComplete="name"
            required
            value={refereeName}
            onChange={(e) => setRefereeName(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          data-testid="referee-submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Sending…' : 'Send invitation'}
        </button>
      </form>

      <ErrorBanner error={error} />
    </section>
  );
}
