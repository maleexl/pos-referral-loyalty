/**
 * FILE: backend/src/routes/customers.ts
 * PURPOSE: HTTP layer for Customer resource. Wires requests to usecases;
 *          no business logic here. Response shapes match docs/API-CONTRACT.md F1.
 * CALLED BY: backend/src/app.ts (registered as a route group).
 * CALLS: backend/src/usecases/registerCustomer.ts,
 *        backend/src/usecases/getCustomerByCode.ts.
 */
import type { FastifyInstance } from 'fastify';
import { registerCustomer } from '../usecases/registerCustomer.js';
import { getCustomerByCode } from '../usecases/getCustomerByCode.js';

// WHY: shape the customer for the wire. Keep this next to the routes so the
// API contract has exactly one place to change if the frontend needs more.
// Never expose internal fields we might add later (e.g. soft-delete flags).
function toApi(customer: {
  id: string;
  email: string;
  phone: string;
  name: string;
  referralCode: string;
  createdAt: Date;
}): {
  id: string;
  email: string;
  phone: string;
  name: string;
  referralCode: string;
  pointsBalance: number;
  createdAt: string;
} {
  return {
    id: customer.id,
    email: customer.email,
    phone: customer.phone,
    name: customer.name,
    referralCode: customer.referralCode,
    // WHY: pointsBalance is derived (SUM of ledger). New customers have no
    // rewards yet, so it is always 0 here. Later endpoints that read
    // rewards will compute the real balance.
    pointsBalance: 0,
    createdAt: customer.createdAt.toISOString()
  };
}

export async function customerRoutes(app: FastifyInstance): Promise<void> {
  // --- POST /api/customers ------------------------------------------------
  app.post('/api/customers', async (req, reply) => {
    // WHY: pass raw body to the usecase — zod parse errors bubble to the
    // global error handler and become 400 INVALID_INPUT with details.
    const customer = await registerCustomer(req.body);
    reply.status(201).send(toApi(customer));
  });

  // --- GET /api/customers/:referralCode -----------------------------------
  app.get<{ Params: { referralCode: string } }>(
    '/api/customers/:referralCode',
    async (req) => {
      const customer = await getCustomerByCode(req.params.referralCode);
      return toApi(customer);
    }
  );
}
