/**
 * FILE: backend/src/server.ts
 * PURPOSE: Process entry point. Loads env, builds the Fastify app, listens for
 *          HTTP traffic, and shuts down gracefully on SIGINT/SIGTERM.
 * CALLED BY: npm run dev (tsx watch src/server.ts); future prod entry.
 * CALLS: backend/src/app.ts, dotenv/config, node:process.
 */
import 'dotenv/config';
import { buildApp } from './app.js';

// WHY: named constants instead of inline literals — keeps the fallback visible
// and avoids "magic number" drift between code and docs.
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HOST = process.env.HOST ?? DEFAULT_HOST;
const CORS_ORIGIN = process.env.CORS_ORIGIN;

async function main(): Promise<void> {
  const app = await buildApp({ corsOrigin: CORS_ORIGIN });

  // WHY: register signal handlers BEFORE listen() so we cannot miss a stop
  // signal during the brief startup window.
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err: unknown) => {
  // WHY: if boot fails, exit non-zero so process managers (systemd, docker,
  // tsx watch) can restart or surface the failure. Log to stderr, not logger,
  // because the logger may not exist yet.
  console.error(err);
  process.exit(1);
});
