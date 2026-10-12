/**
 * FILE: frontend/src/main.tsx
 * PURPOSE: App entry point. Mounts <App/> into #root under React.StrictMode.
 *          Everything past this point is React-side — routing, layout, and
 *          data fetching all live under App.
 * CALLED BY: frontend/index.html via <script type="module" src="/src/main.tsx">.
 * CALLS: react, react-dom/client, react-router-dom, ./App, ./index.css.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import './index.css';

// WHY: fail fast if the mount point is missing. A silent null-check would
// hide a broken index.html and produce a blank page with no console error.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    {/* WHY: BrowserRouter at the top — App only declares routes. Keeping
        the router external lets tests wrap App in a MemoryRouter later. */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
