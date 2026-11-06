// Rate limiting: stops one visitor from flooding the API, and caps total daily
// Gemini use so a quota or bill can never run away.
//
// How it works: every request bumps a counter for (policy, visitor, time window).
// When a counter goes over its limit the request is refused with 429 + Retry-After.
// Counters live in MongoDB (shared by all serverless instances, which do NOT share
// memory on Vercel) and delete themselves via a TTL index. Visitor IP addresses are
// stored only as salted hashes.
import { createHmac } from 'node:crypto';
import { collections } from './db.js';
import { HttpError } from './http.js';

// --- storage -------------------------------------------------------------

export interface RateLimitStore {
  // Adds 1 to the counter `key` and returns the new total. The counter may be
  // deleted after `expiresAt`.
  increment(key: string, expiresAt: Date): Promise<number>;
}

const isDuplicateKeyError = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

export const mongoStore: RateLimitStore = {
  async increment(key, expiresAt) {
    const col = await collections.rateLimits();
    // Two requests creating the same counter at the same instant can collide
    // (duplicate key); the loser simply retries and increments the winner's.
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await col.findOneAndUpdate(
          { _id: key },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, returnDocument: 'after' },
        );
        return doc?.count ?? 1;
      } catch (err) {
        if (isDuplicateKeyError(err) && attempt < 3) continue;
        throw err;
      }
    }
  },
};

// In-memory store, used by tests (and fine for a single local process).
export function createMemoryStore(): RateLimitStore {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  return {
    async increment(key, expiresAt) {
      const nowMs = Date.now();
      if (counters.size > 1000) {
        for (const [k, v] of counters) if (v.expiresAt < nowMs) counters.delete(k);
      }
      const entry = counters.get(key) ?? { count: 0, expiresAt: expiresAt.getTime() };
      entry.count += 1;
      counters.set(key, entry);
      return entry.count;
    },
  };
}

let store: RateLimitStore | undefined;
export function setRateLimitStore(replacement: RateLimitStore | undefined): void {
  store = replacement;
}
const getStore = () => (store ??= mongoStore);

// --- policies ------------------------------------------------------------

interface Rule {
  windowSeconds: number;
  max: number;
  scope: 'client' | 'global'; // per visitor, or shared by everyone
}

// Total chat messages per day for the whole app (each one costs 2-3 Gemini calls).
// Set GLOBAL_DAILY_CHAT_LIMIT to match your Gemini quota.
export const DEFAULT_GLOBAL_DAILY_CHAT_LIMIT = 100;

function globalDailyChatLimit(): number {
  const n = Number.parseInt(process.env.GLOBAL_DAILY_CHAT_LIMIT ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_GLOBAL_DAILY_CHAT_LIMIT;
}

const POLICIES = {
  // AI chat: the expensive one.
  chat: (): Rule[] => [
    { windowSeconds: 60, max: 6, scope: 'client' },
    { windowSeconds: 3600, max: 40, scope: 'client' },
    { windowSeconds: 86_400, max: globalDailyChatLimit(), scope: 'global' },
  ],
  // Looking up an order/refund needs a matching order ID + phone, so these are
  // the endpoints someone would hammer to guess combinations.
  lookup: (): Rule[] => [
    { windowSeconds: 60, max: 20, scope: 'client' },
    { windowSeconds: 3600, max: 200, scope: 'client' },
  ],
  // Endpoints that write to the database.
  write: (): Rule[] => [
    { windowSeconds: 60, max: 10, scope: 'client' },
    { windowSeconds: 3600, max: 60, scope: 'client' },
  ],
  search: (): Rule[] => [{ windowSeconds: 60, max: 60, scope: 'client' }],
};

export type PolicyName = keyof typeof POLICIES;

// --- identifying the visitor ----------------------------------------------

// On Vercel these headers are set by the platform, not by the visitor.
export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get('x-vercel-forwarded-for') ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  );
}

function hashClient(ip: string): string {
  let salt = process.env.RATE_LIMIT_SALT;
  if (!salt) {
    // Without a secret salt, hashed IPv4 addresses could be reversed by brute force.
    if (process.env.VERCEL) throw new Error('Missing environment variable RATE_LIMIT_SALT. See .env.example.');
    salt = 'local-development-salt';
  }
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 32);
}

// --- the check -------------------------------------------------------------

// Call at the top of every endpoint (after the method check). Throws a 429
// HttpError, with a Retry-After header, when any rule for the policy is exceeded.
export async function limitRequest(request: Request, policy: PolicyName, now = new Date()): Promise<void> {
  const rules = POLICIES[policy]();
  const client = hashClient(clientIp(request));
  const nowSec = Math.floor(now.getTime() / 1000);

  const results = await Promise.all(
    rules.map(async (rule) => {
      const windowStart = Math.floor(nowSec / rule.windowSeconds) * rule.windowSeconds;
      const windowEnd = windowStart + rule.windowSeconds;
      const id = rule.scope === 'global' ? 'global' : client;
      const key = `${policy}|${id}|${rule.windowSeconds}|${windowStart}`;
      // Keep the document a minute past the window so clock differences cannot revive a counter.
      const count = await getStore().increment(key, new Date((windowEnd + 60) * 1000));
      return { rule, count, retryAfter: Math.max(1, windowEnd - nowSec) };
    }),
  );

  const exceeded = results.filter((r) => r.count > r.rule.max);
  if (exceeded.length === 0) return;

  const retryAfter = Math.max(...exceeded.map((r) => r.retryAfter));
  if (exceeded.some((r) => r.rule.scope === 'global')) {
    throw new HttpError(
      429,
      'The assistant has reached its daily limit for this demo. Please try again tomorrow.',
      'DAILY_LIMIT_REACHED',
      retryAfter,
    );
  }
  throw new HttpError(
    429,
    `Too many requests. Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} and try again.`,
    'RATE_LIMITED',
    retryAfter,
  );
}
