import { MongoClient, type Db } from 'mongodb';
import { readEnv } from './env.js';
import { HttpError } from './http.js';
import { logError } from './log.js';
import type {
  Customer,
  Handoff,
  Order,
  Product,
  Query,
  RateLimitCounter,
  Refund,
} from './types.js';

// The connection is cached in a module-level variable. Vercel reuses a warm
// function instance for many requests, so this avoids reconnecting each time.
// We cache the *promise*, so simultaneous requests share one connection attempt,
// and we throw it away if the attempt fails so the next request starts clean.
let clientPromise: Promise<MongoClient> | undefined;

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

// Give up on MongoDB well before Vercel's own function time limit (30s for /api/chat).
// Without this, an unreachable database makes the request hang until Vercel kills
// it, which leaves a bare 504 and NO log line explaining why.
function timeoutMs(): number {
  const n = Number.parseInt(process.env.MONGODB_TIMEOUT_MS ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : 8000;
}

// --- explaining connection failures --------------------------------------------

export type DbFailureKind = 'network' | 'auth' | 'uri-format' | 'unknown';

const DB_HINTS: Record<DbFailureKind, string> = {
  network:
    'Could not reach MongoDB. In MongoDB Atlas > Network Access allow 0.0.0.0/0 (Vercel has no fixed IP address), make sure the cluster is not paused, and check the host name in MONGODB_URI.',
  auth: 'MongoDB rejected the login. Check the user name and password in MONGODB_URI (special characters in the password must be URL-encoded) and that the Atlas database user exists.',
  'uri-format':
    'MONGODB_URI is not a valid connection string. It must start with mongodb+srv:// or mongodb://, with no spaces or quotes, and special characters in the password must be URL-encoded.',
  unknown: 'Unexpected MongoDB error. See name/code/message in this log line.',
};

// MongoServerSelectionError hides the real reason (DNS, refused, bad login, TLS)
// inside the per-server details; collect those short messages for the log.
function serverErrorMessages(err: unknown): string[] {
  const servers = (err as { reason?: { servers?: unknown } } | null)?.reason?.servers;
  if (!(servers instanceof Map)) return [];
  return [...servers.values()]
    .map((s) => (s as { error?: { message?: unknown } | null } | null)?.error?.message)
    .filter((m): m is string => typeof m === 'string')
    .slice(0, 3);
}

export function classifyDbError(err: unknown): DbFailureKind {
  const e = err as { name?: unknown; code?: unknown; codeName?: unknown; message?: unknown } | null;
  const name = String(e?.name ?? '');
  const text = [String(e?.message ?? ''), ...serverErrorMessages(err)].join(' | ');
  if (name === 'MongoParseError' || /invalid scheme|invalid connection string|URI malformed/i.test(text)) {
    return 'uri-format';
  }
  if (e?.code === 18 || e?.codeName === 'AuthenticationFailed' || /bad auth|authentication failed/i.test(text)) {
    return 'auth';
  }
  if (/^Mongo(ServerSelection|Network|NetworkTimeout)Error$/.test(name) || /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(text)) {
    return 'network';
  }
  return 'unknown';
}

// What callers (and the /api/health check) see when the database cannot be used.
export class DbUnavailableError extends HttpError {
  kind: DbFailureKind;
  constructor(kind: DbFailureKind) {
    super(503, 'The database is temporarily unavailable. Please try again in a moment.', 'DB_UNAVAILABLE');
    this.kind = kind;
  }
}

// One connection attempt. A failure is logged HERE, once per attempt, even if several
// simultaneous requests are waiting on it (the rate limiter alone makes three).
async function connect(): Promise<MongoClient> {
  // A missing/blank MONGODB_URI is a setup mistake: it surfaces as a plain error (500, logged by the API).
  const client = new MongoClient(requireEnv('MONGODB_URI'), {
    serverSelectionTimeoutMS: timeoutMs(),
    connectTimeoutMS: timeoutMs(),
    maxPoolSize: 10,
  });
  try {
    await client.connect();
    return client;
  } catch (err) {
    await client.close().catch(() => {});
    const kind = classifyDbError(err);
    logError('db.connect_failed', err, {
      kind,
      hint: DB_HINTS[kind],
      serverErrors: serverErrorMessages(err),
      timeoutMs: timeoutMs(),
    });
    throw new DbUnavailableError(kind);
  }
}

export async function getDb(): Promise<Db> {
  if (!clientPromise) {
    const attempt = connect();
    clientPromise = attempt;
    // A failed attempt must not stay cached, or this instance could never recover.
    attempt.catch(() => {
      if (clientPromise === attempt) clientPromise = undefined;
    });
  }
  const client = await clientPromise;
  return client.db(readEnv('MONGODB_DB') ?? 'blinkit_support');
}

export async function closeDb(): Promise<void> {
  const pending = clientPromise;
  clientPromise = undefined;
  if (pending) await (await pending.catch(() => undefined))?.close();
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
