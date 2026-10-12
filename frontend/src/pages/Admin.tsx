/**
 * FILE: frontend/src/pages/Admin.tsx
 * PURPOSE: Placeholder for the admin-facing page. Sprint 3 will implement
 *          referral list, redemption list, and editable settings
 *          (GET/PATCH /admin/*). Requires X-Admin-Key.
 * CALLED BY: frontend/src/App.tsx (route /admin).
 * CALLS: (none yet — placeholder).
 */
export default function AdminPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="text-sm text-gray-600">
        Placeholder — referral/redemption tables and the settings editor will
        land in Sprint 3. An admin key prompt will be required for /admin
        endpoints.
      </p>
    </section>
  );
}
