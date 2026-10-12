/**
 * FILE: frontend/src/App.tsx
 * PURPOSE: Root component. Declares the app's route table and wraps pages
 *          in a shared Layout. No business logic — Sprint 3 fills in pages.
 * CALLED BY: frontend/src/main.tsx.
 * CALLS: react-router-dom, ./components/Layout.js, ./pages/*.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.js';
import CustomerPage from './pages/Customer.js';
import StaffPage from './pages/Staff.js';
import AdminPage from './pages/Admin.js';

export default function App() {
  return (
    <Routes>
      {/* WHY: shared Layout renders nav + <Outlet/> — every page inherits
          chrome without repeating markup per page. */}
      <Route element={<Layout />}>
        {/* WHY: root redirects to /customer — the primary audience for a
            referral link is the customer, and staff/admin are staff-only
            entry points they'll navigate to explicitly. */}
        <Route index element={<Navigate to="/customer" replace />} />
        <Route path="customer" element={<CustomerPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="admin" element={<AdminPage />} />
        {/* WHY: catch-all — unknown URLs also land on /customer rather than
            a blank screen. Sprint 3 may replace with a dedicated 404. */}
        <Route path="*" element={<Navigate to="/customer" replace />} />
      </Route>
    </Routes>
  );
}
