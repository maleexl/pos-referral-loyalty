/**
 * FILE: frontend/src/components/Layout.tsx
 * PURPOSE: Shared shell — top nav with links to the three pages, then the
 *          current page via <Outlet/>. Sprint 2 keeps styling minimal.
 * CALLED BY: frontend/src/App.tsx (as a parent route element).
 * CALLS: react-router-dom (NavLink, Outlet).
 */
import { NavLink, Outlet } from 'react-router-dom';

// WHY: single source of truth for nav items — adding a page means one entry
// here plus one <Route> in App.tsx, no scattered duplicates.
const NAV_ITEMS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/customer', label: 'Customer' },
  { to: '/staff', label: 'Staff' },
  { to: '/admin', label: 'Admin' }
];

export default function Layout() {
  return (
    <div className="min-h-full flex flex-col bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <nav className="max-w-4xl mx-auto flex items-center gap-6 px-4 py-3">
          <span className="font-semibold">POS Referral &amp; Loyalty</span>
          <ul className="flex gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                {/* WHY: NavLink applies the "active" class when the current
                    URL matches — no manual location comparison needed. */}
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    isActive
                      ? 'text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-gray-900'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
