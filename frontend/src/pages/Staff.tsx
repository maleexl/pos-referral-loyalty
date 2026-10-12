/**
 * FILE: frontend/src/pages/Staff.tsx
 * PURPOSE: Placeholder for the staff-facing page. Sprint 3 will implement
 *          customer lookup, redemption issue (/staff/redeem), and redemption
 *          confirm (/staff/redeem/confirm). Requires X-Staff-Key.
 * CALLED BY: frontend/src/App.tsx (route /staff).
 * CALLS: (none yet — placeholder).
 */
export default function StaffPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-xl font-semibold">Staff</h1>
      <p className="text-sm text-gray-600">
        Placeholder — lookup and redemption UI will land in Sprint 3. A staff
        key prompt will be required for /staff endpoints.
      </p>
    </section>
  );
}
