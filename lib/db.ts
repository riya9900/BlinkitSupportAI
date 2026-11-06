import { MongoClient, type Db } from 'mongodb';
import type {
  Customer,
  Handoff,
  Order,
  Product,
  Query,
  RateLimitCounter,
  Refund,
} from './types.js';

// The client is cached in a module-level variable. Vercel reuses a warm
// function instance for many requests, so this avoids reconnecting each time.
let client: MongoClient | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

export async function getDb(): Promise<Db> {
  if (!client) {
    client = new MongoClient(requireEnv('MONGODB_URI'));
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB ?? 'blinkit_support');
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = undefined;
}

// Safe to run repeatedly. Unique partial indexes make the database itself
// refuse duplicates, even if two requests arrive at the same instant:
//  - one active (pending/approved) refund per order
//  - one active (waiting/assigned) human handoff per customer
export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection<Refund>('refunds').createIndex(
    { orderId: 1 },
    {
      unique: true,
      name: 'one_active_refund_per_order',
      partialFilterExpression: { status: { $in: ['pending', 'approved'] } },
    },
  );
  await db.collection<Handoff>('handoffs').createIndex(
    { customerId: 1 },
    {
      unique: true,
      name: 'one_active_handoff_per_customer',
      partialFilterExpression: { status: { $in: ['waiting', 'assigned'] } },
    },
  );
  // Rate-limit counters delete themselves once their time window is over.
  await db.collection<RateLimitCounter>('ratelimits').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'ratelimit_ttl' },
  );
  // Customers are looked up by phone number on every request.
  await db.collection<Customer>('customers').createIndex(
    { phone: 1 },
    { unique: true, name: 'customer_phone_unique' },
  );
}

// Typed accessors, one per collection.
export const collections = {
  customers: async () => (await getDb()).collection<Customer>('customers'),
  orders: async () => (await getDb()).collection<Order>('orders'),
  products: async () => (await getDb()).collection<Product>('products'),
  refunds: async () => (await getDb()).collection<Refund>('refunds'),
  queries: async () => (await getDb()).collection<Query>('queries'),
  handoffs: async () => (await getDb()).collection<Handoff>('handoffs'),
  rateLimits: async () => (await getDb()).collection<RateLimitCounter>('ratelimits'),
};
