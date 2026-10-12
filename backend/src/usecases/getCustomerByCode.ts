/**
 * FILE: backend/src/usecases/getCustomerByCode.ts
 * PURPOSE: Looks up a Customer by referral code. Throws NotFoundError when
 *          the code does not exist so the route layer stays thin.
 * CALLED BY: backend/src/routes/customers.ts
 * CALLS: backend/src/db/prisma.ts, backend/src/errors.ts, @prisma/client.
 */
import type { Customer } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { NotFoundError } from '../errors.js';

export async function getCustomerByCode(referralCode: string): Promise<Customer> {
  // WHY: no .toUpperCase() here — codes are stored uppercase (see
  // registerCustomer.ts extractPrefix). Normalizing the input silently would
  // hide a client bug (e.g. sending lowercase) rather than exposing it as 404.
  const customer = await prisma.customer.findUnique({
    where: { referralCode }
  });
  if (!customer) {
    throw new NotFoundError(`Customer with code "${referralCode}" not found`);
  }
  return customer;
}
