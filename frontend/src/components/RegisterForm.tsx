/**
 * FILE: frontend/src/components/RegisterForm.tsx
 * PURPOSE: Customer registration form (F1). Submits to POST /api/customers,
 *          persists the returned referralCode to localStorage, then hands
 *          the customer up to the page so it can swap in the referral card.
 * CALLED BY: src/pages/Customer.tsx.
 * CALLS: src/hooks/useMutation.ts, src/lib/storage.ts,
 *        src/components/ErrorBanner.tsx, src/lib/types.ts.
 */
import { useState, type FormEvent } from 'react';
import { useMutation } from '../hooks/useMutation.js';
import { setStoredReferralCode } from '../lib/storage.js';
import type { Customer, RegisterCustomerInput } from '../lib/types.js';
import ErrorBanner from './ErrorBanner.js';

interface RegisterFormProps {
  // WHY: parent decides what to do on success (persist state, swap view).
  // Keeping this component free of navigation/state ownership lets it stay
  // reusable if a "register another customer" flow appears later.
  onSuccess: (customer: Customer) => void;
}

export default function RegisterForm({ onSuccess }: RegisterFormProps) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');

  const { run, loading, error } = useMutation<
    RegisterCustomerInput,
    Customer
  >({ method: 'POST', path: '/api/customers' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const customer = await run({ email, phone, name });
      // WHY: persist before notifying the parent. If the parent throws for
      // any reason, we still want the code cached so the next mount finds
      // it and the user does not have to register twice.
      setStoredReferralCode(customer.referralCode);
      onSuccess(customer);
    } catch {
      // WHY: useMutation already captured the ApiError into its own state
      // and the ErrorBanner below renders it. Swallowing the re-throw here
      // prevents an unhandled promise rejection — the user-visible feedback
      // is the error banner, not a console message.
    }
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Register</h2>
        <p className="text-sm text-gray-600">
          Enter your details to receive a referral code and start earning
          points.
        </p>
      </header>

      <form
        data-testid="register-form"
        onSubmit={handleSubmit}
        className="space-y-3 max-w-sm"
      >
        <div className="space-y-1">
          <label
            htmlFor="register-email"
            className="block text-sm font-medium"
          >
            Email
          </label>
          <input
            id="register-email"
            data-testid="register-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label
            htmlFor="register-phone"
            className="block text-sm font-medium"
          >
            Phone
          </label>
          <input
            id="register-phone"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="register-name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          data-testid="register-submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Registering…' : 'Register'}
        </button>
      </form>

      <ErrorBanner error={error} />
    </section>
  );
}
