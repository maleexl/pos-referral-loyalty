/**
 * FILE: frontend/tailwind.config.js
 * PURPOSE: Tailwind v3 content globs + theme extensions. Kept minimal in
 *          Sprint 2 — design tokens land in Sprint 3 once the UI takes shape.
 * CALLED BY: postcss.config.js (Tailwind runs as a PostCSS plugin).
 * CALLS: (none — config data only).
 */

/** @type {import('tailwindcss').Config} */
export default {
  // WHY: v3 explicit content globs — v4 auto-detects, but v3 requires the
  // list. Keep it tight so unused classes from node_modules never inflate
  // the final bundle.
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // WHY: extend (not replace) — the default Tailwind palette remains
      // available; Sprint 3 will add brand colors alongside it.
    }
  },
  plugins: []
};
