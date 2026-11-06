// Support service: saves customer complaints/queries and human-agent handoffs.
// Gemini never writes these itself; it asks the backend, which validates first.
import { randomBytes } from 'node:crypto';
import { collections } from './db.js';
import { HttpError } from './http.js';
import { findOwnedOrder } from './orders.js';
import type { Customer, Handoff, Query } from './types.js';
import type { HandoffInput, QueryInput } from './validation.js';

export const MAX_OPEN_QUERIES = 5; // per customer, to stop spam

// One message for "unknown phone" and "order is not yours", so the API cannot
// be used to find out which phone numbers or order IDs exist.
const CANNOT_VERIFY = 'We could not verify those details. Please check the phone number and order ID.';

const newId = (prefix: string) => `${prefix}${randomBytes(4).toString('hex').toUpperCase()}`;

async function verifyCustomer(phone: string, orderId?: string): Promise<Customer> {
  const customer = await (await collections.customers()).findOne({ phone });
  if (!customer) throw new HttpError(404, CANNOT_VERIFY);
  if (orderId) {
    const order = await findOwnedOrder(orderId, phone);
    if (!order) throw new HttpError(404, CANNOT_VERIFY);
  }
  return customer;
}

const isDuplicateKeyError = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export async function createQuery(input: QueryInput, now = new Date()): Promise<Query> {
  const customer = await verifyCustomer(input.phone, input.orderId);
  const queries = await collections.queries();

  const open = await queries.countDocuments({ customerId: customer._id, status: 'open' });
  if (open >= MAX_OPEN_QUERIES) {
    throw new HttpError(
      429,
      `You already have ${MAX_OPEN_QUERIES} open requests. Please wait for them to be resolved.`,
      'TOO_MANY_OPEN_QUERIES',
    );
  }

  const query: Query = {
    _id: newId('QRY'),
    customerId: customer._id,
    type: input.type,
    subject: input.subject,
    message: input.message,
    status: 'open',
    createdAt: now,
    ...(input.orderId ? { orderId: input.orderId } : {}),
  };
  await queries.insertOne(query);
  return query;
}

// Returns the handoff and whether it was newly created. If the customer
// already has an active handoff, that one is returned instead (created: false),
// so a retried chat message never creates a duplicate.
export async function createHandoff(
  input: HandoffInput,
  now = new Date(),
): Promise<{ handoff: Handoff; created: boolean }> {
  const customer = await verifyCustomer(input.phone, input.orderId);
  const handoffs = await collections.handoffs();
  const activeFilter = { customerId: customer._id, status: { $in: ['waiting', 'assigned'] as Handoff['status'][] } };

  const existing = await handoffs.findOne(activeFilter);
  if (existing) return { handoff: existing, created: false };

  const handoff: Handoff = {
    _id: newId('HND'),
    customerId: customer._id,
    reason: input.reason,
    conversationSummary: input.conversationSummary,
    status: 'waiting',
    createdAt: now,
    ...(input.orderId ? { orderId: input.orderId } : {}),
  };
  try {
    await handoffs.insertOne(handoff);
    return { handoff, created: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // A simultaneous request won the race; return its handoff.
      const winner = await handoffs.findOne(activeFilter);
      if (winner) return { handoff: winner, created: false };
    }
    throw err;
  }
}
