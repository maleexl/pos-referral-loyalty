/**
 * FILE: frontend/vite.config.ts
 * PURPOSE: Vite build + dev server config. Minimal by design — React plugin
 *          only. API base URL is read from import.meta.env at runtime (see
 *          src/lib/api.ts), NOT proxied here, so the same bundle works
 *          against any backend URL without rebuilding.
 * CALLED BY: vite CLI (npm run dev / build / preview).
 * CALLS: vite, @vitejs/plugin-react.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WHY: no server.proxy — we want to exercise CORS on the backend (which is
// configured via CORS_ORIGIN env). A proxy would hide CORS bugs until prod.
export default defineConfig({
  plugins: [react()],
  server: {
    // WHY: fixed port matches backend/.env CORS_ORIGIN default
    // (http://localhost:5173). strictPort fails fast on a port clash rather
    // than silently shifting to 5174 and breaking the CORS origin allow-list.
    port: 5173,
    strictPort: true
  }
});
