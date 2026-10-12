/**
 * FILE: backend/src/db/prisma.ts
 * PURPOSE: Singleton PrismaClient. Prevents connection-pool exhaustion during
 *          hot reload (`tsx watch` re-evaluates modules on every save) and
 *          gives the rest of the app a single import surface for DB access.
 * CALLED BY: usecases, settings loader, route handlers, seed script.
 * CALLS: @prisma/client (generated client at backend/node_modules/.prisma/client).
 */
import { PrismaClient } from '@prisma/client';

// WHY: in development, tsx watch reloads modules and would otherwise create a
// new PrismaClient on every file save, leaking DB connections. We attach the
// instance to globalThis so reloads reuse the same client.
// In production, the process is long-lived and only loads once — no global needed.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // WHY: log level from env, defaulted to warn in prod to keep logs quiet.
    // 'query' would print every SQL statement — useful in dev, noisy in prod.
    log:
      process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
