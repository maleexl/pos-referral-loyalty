/**
 * FILE: frontend/src/pages/Admin.tsx
 * PURPOSE: Admin page. Two-state flow: (1) key prompt if none stored,
 *          (2) three data sections (referrals, redemptions, settings).
 *          Any 401 from an admin endpoint clears the stored key and drops
 *          back to the prompt — the server is the authority on key
 *          validity.
 * CALLED BY: frontend/src/App.tsx (route /admin).
 * CALLS: src/components/{AdminKeyPrompt,ReferralTable,RedemptionTable,SettingsEditor}.tsx,
 *        src/lib/api.ts (ApiError), src/lib/storage.ts.
 */
import { useCallback, useState } from 'react';
import { ApiError } from '../lib/api.js';
import AdminKeyPrompt from '../components/AdminKeyPrompt.js';
import ReferralTable from '../components/ReferralTable.js';
import RedemptionTable from '../components/RedemptionTable.js';
import SettingsEditor from '../components/SettingsEditor.js';
import {
  clearStoredAdminKey,
  getStoredAdminKey
} from '../lib/storage.js';

export default function AdminPage() {
  // WHY: lazy initializer reads storage once on mount. Subsequent renders
  // use state, so a 401-driven clear flows through setAdminKey — the page
  // never re-queries localStorage during the session.
  const [adminKey, setAdminKey] = useState<string | null>(() =>
    getStoredAdminKey()
  );

  // WHY: single 401 handler for all three sections. Clearing the stored
  // key (not just React state) means a reload does not resurrect a stale
  // key that the server has already rejected.
  const handleAdminError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      clearStoredAdminKey();
      setAdminKey(null);
    }
    // WHY: non-401 errors are shown by the section that owns the request
    // (its ErrorBanner reads useApi/useMutation.error). Swallowing here
    // avoids duplicate banners for the same failure.
  }, []);

  if (adminKey === null) {
    return <AdminKeyPrompt onAccepted={setAdminKey} />;
  }

  return (
    <section className="space-y-8">
      <h1 className="text-xl font-semibold">Admin</h1>

      <ReferralTable adminKey={adminKey} onError={handleAdminError} />
      <RedemptionTable adminKey={adminKey} onError={handleAdminError} />
      <SettingsEditor adminKey={adminKey} onError={handleAdminError} />
    </section>
  );
}
