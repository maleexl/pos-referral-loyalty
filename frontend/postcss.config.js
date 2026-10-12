/**
 * FILE: frontend/postcss.config.js
 * PURPOSE: PostCSS plugin chain — Tailwind first, then autoprefixer for
 *          vendor prefixes. Vite picks this up automatically.
 * CALLED BY: Vite build pipeline (no explicit import needed).
 * CALLS: tailwindcss, autoprefixer.
 */
export default {
  // WHY: array order matters. Tailwind expands @tailwind directives into
  // utility CSS, then autoprefixer adds vendor prefixes to the result.
  // Reversing would leave Tailwind-generated rules unprefixed.
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
