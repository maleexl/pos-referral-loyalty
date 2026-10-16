/**
 * FILE: backend/src/app.ts
 * PURPOSE: Builds and returns the Fastify application instance with plugins,
 *          routes, and global error handling wired up. Pure builder — this
 *          module never calls listen(), so tests can exercise it via inject().
 * CALLED BY: backend/src/server.ts (runtime), all backend test suites
 *            (health, customers, referrals, admin, rewards, settings,
 *            pos-visits, customer-referrals) via inject().
 * CALLS: fastify, @fastify/cors, zod, backend/src/errors.ts,
 *        backend/src/routes/* (customers, referrals, internal, staff, admin).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { ApiError } from './errors.js';
import { customerRoutes } from './routes/customers.js';
import { referralRoutes } from './routes/referrals.js';
import { internalRoutes } from './routes/internal.js';
import { staffRoutes } from './routes/staff.js';
import { adminRoutes } from './routes/admin.js';

export interface BuildAppOptions {
  /**
   * CORS origin from env. When undefined, the CORS plugin is NOT registered —
   * tests and server-to-server callers do not need it.
   */
  corsOrigin?: string;
  /** Fastify logger flag. Tests pass false to silence output. Defaults to true. */
  logger?: boolean;
}

export async function buildApp(
  opts: BuildAppOptions = {}
): Promise<FastifyInstance> {
  // WHY: logger defaults to true in runtime; tests explicitly pass false to
  // keep CI output clean and deterministic.
  const app = Fastify({ logger: opts.logger ?? true });

  // WHY: only register CORS when an origin is configured. Avoids surprising
  // browser behavior in tests and keeps startup minimal.
  if (opts.corsOrigin) {
    await app.register(cors, { origin: opts.corsOrigin });
  }

  // -------------------------------------------------------------------------
  // Global error handler — see docs/API-CONTRACT.md "Standard Errors"
  // -------------------------------------------------------------------------
  // WHY: one place to translate thrown errors into the wire format.
  // Routes/usecases throw typed errors; they never construct HTTP responses.
  app.setErrorHandler((err, req, reply) => {
    // --- 1. Domain errors -------------------------------------------------
    if (err instanceof ApiError) {
      // WHY: prefer err.message over err.name — messages are user-facing,
      // names are class identifiers (ConflictError etc.).
      // WHY: spread err.details FIRST so it cannot override error/code —
      // callers may pass visit info (F2b 409) but never touch the envelope.
      reply.status(err.statusCode).send({
        ...(err.details && typeof err.details === 'object' ? err.details : {}),
        error: err.message,
        code: err.code
      });
      return;
    }

    // --- 2. Zod validation errors ----------------------------------------
    // WHY: usecases validate input via zod; failures become 400 with details
    // so the frontend can highlight individual fields.
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: 'Validation failed',
        code: 'INVALID_INPUT',
        // WHY: flatten().fieldErrors gives { [field]: string[] } — stable
        // shape the frontend can iterate. details may include paths for
        // nested schemas in the future.
        details: err.flatten().fieldErrors
      });
      return;
    }

    // --- 3. Everything else = unexpected ---------------------------------
    // WHY: log at error level with the full stack so ops can diagnose, but
    // never leak internals to the client in production. In dev, surface the
    // real message to speed up debugging.
    req.log.error({ err }, 'unhandled error');
    const isProd = process.env.NODE_ENV === 'production';
    // WHY: Fastify types the handler's `err` as `unknown`. Narrow to Error
    // before touching .message — anything thrown that is not an Error has
    // no .message field, and in prod we never echo its shape anyway.
    const message =
      !isProd && err instanceof Error ? err.message : 'Internal server error';
    reply.status(500).send({
      error: message,
      code: 'INTERNAL'
    });
  });

  // WHY: Fastify's default 404 body is { statusCode, error, message } — does
  // not match API-CONTRACT. Override to keep every response shape consistent.
  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({
      error: 'Route not found',
      code: 'NOT_FOUND'
    });
  });

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  // WHY: /health is intentionally unauthenticated and does NOT touch the DB
  // or any external service — CI, load balancers, and humans rely on it as
  // a pure liveness signal (see SPEC.md §6 Performance).
  app.get('/health', async () => ({
    status: 'ok',
    service: 'pos-referral-loyalty-backend'
  }));

  // WHY: route groups are registered as plugins so their hooks/scopes stay
  // encapsulated. Order matters only for wildcard routes — none here yet.
  await app.register(customerRoutes);
  await app.register(referralRoutes);
  // WHY: /internal/mock-pos/* stands in for the POS and has no auth (see
  // routes/internal.ts). It must never be reachable in production, so we skip
  // registration entirely there — a prod request then falls through to the
  // custom 404 envelope above instead of awarding points. Dev/CI/E2E keep the
  // mock. No env var, no contract change: the route simply does not exist.
  if (process.env.NODE_ENV !== 'production') {
    await app.register(internalRoutes);
  }
  // WHY prefix here (not inside the plugin): the auth hook in staffRoutes
  // would still apply; the URL shape is a composition concern, not the
  // plugin's. This also makes /staff a single grep target for ops review.
  await app.register(staffRoutes, { prefix: '/staff' });
  // WHY prefix here (not inside the plugin): mirrors staffRoutes — the auth
  // hook scope is the plugin, the URL shape is the composition root's
  // concern. /admin becomes a single grep target for ops review.
  await app.register(adminRoutes, { prefix: '/admin' });

  return app;
}
