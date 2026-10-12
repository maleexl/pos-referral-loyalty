/**
 * FILE: backend/src/usecases/getAllSettings.ts
 * PURPOSE: Read-only entry point for the admin settings view. Thin wrapper
 *          over the settings loader so the route layer never imports the
 *          loader directly — keeps the "route → usecase → infra" layering
 *          uniform across the codebase.
 * CALLED BY: backend/src/routes/admin.ts
 * CALLS: backend/src/settings/loader.ts.
 */
import { settings } from '../settings/loader.js';

export async function getAllSettings(): Promise<Record<string, string>> {
  // WHY: no transformation — the loader already returns the schema-ordered
  // map that the API exposes. Adding a passthrough usecase (rather than
  // calling settings.getAll() directly from the route) preserves the pattern
  // used by every other route file, so future cross-cutting concerns
  // (metrics, audit logs) have a natural home.
  return settings.getAll();
}
