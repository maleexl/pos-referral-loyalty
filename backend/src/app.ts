/**
 * FILE: backend/src/app.ts
 * PURPOSE: Builds and returns the Fastify application instance with plugins,
 *          routes, and (later) error handling wired up. Pure builder — this
 *          module never calls listen(), so tests can exercise it via inject().
 * CALLED BY: backend/src/server.ts (runtime), backend/tests/health.test.ts.
 * CALLS: fastify, @fastify/cors.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

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

  // WHY: /health is intentionally unauthenticated and does NOT touch the DB
  // or any external service — CI, load balancers, and humans rely on it as
  // a pure liveness signal (see SPEC.md §6 Performance).
  app.get('/health', async () => ({
    status: 'ok',
    service: 'pos-referral-loyalty-backend'
  }));

  return app;
}
