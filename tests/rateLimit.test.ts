// Unit tests for rate limiting using an in-memory store. No database. Run: npm test
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { POST as chat, GET as chatGet } from '../api/chat.js';
import { HttpError } from '../lib/http.js';
import {
  clientIp,
  createMemoryStore,
  limitRequest,
  setRateLimitStore,
  type RateLimitStore,
} from '../lib/rateLimit.js';

const req = (ip: string, extra: Record<string, string> = {}) =>
  new Request('http://test/api', { method: 'POST', headers: { 'x-real-ip': ip, ...extra } });

// 10 seconds into a minute (and into an hour, and into a day), so windows are predictable.
const T0 = new Date('2026-01-01T00:00:10Z');
const secondsLater = (s: number) => new Date(T0.getTime() + s * 1000);

const saved = { salt: process.env.RATE_LIMIT_SALT, vercel: process.env.VERCEL, cap: process.env.GLOBAL_DAILY_CHAT_LIMIT };
const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

beforeEach(() => setRateLimitStore(createMemoryStore()));
afterEach(() => {
  restore('RATE_LIMIT_SALT', saved.salt);
  restore('VERCEL', saved.vercel);
  restore('GLOBAL_DAILY_CHAT_LIMIT', saved.cap);
});

const rejection = async (p: Promise<void>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof HttpError, `expected HttpError, got ${e}`);
    return e;
  }
  return assert.fail('expected the request to be refused');
};

test('allows up to the per-minute limit, then refuses with 429 and a Retry-After', async () => {
  for (let i = 0; i < 6; i++) await limitRequest(req('1.1.1.1'), 'chat', T0); // limit is 6 per minute
  const err = await rejection(limitRequest(req('1.1.1.1'), 'chat', T0));
  assert.equal(err.status, 429);
  assert.equal(err.code, 'RATE_LIMITED');
  assert.equal(err.retryAfter, 50); // 10 seconds into the minute -> 50 seconds left
  assert.match(err.message, /50 seconds/);
});

test('the limit resets when the next time window starts', async () => {
  for (let i = 0; i < 6; i++) await limitRequest(req('1.1.1.1'), 'chat', T0);
  await rejection(limitRequest(req('1.1.1.1'), 'chat', T0));
  await limitRequest(req('1.1.1.1'), 'chat', secondsLater(55)); // next minute: allowed again
});

test('the hourly limit still applies after the minute window resets', async () => {
  // 40 per hour. Spread 40 requests over 7 different minutes (6 per minute max).
  let sent = 0;
  for (let minute = 0; sent < 40; minute++) {
    for (let i = 0; i < 6 && sent < 40; i++, sent++) {
      await limitRequest(req('2.2.2.2'), 'chat', secondsLater(minute * 60));
    }
  }
  const err = await rejection(limitRequest(req('2.2.2.2'), 'chat', secondsLater(8 * 60)));
  assert.equal(err.code, 'RATE_LIMITED');
  assert.ok(err.retryAfter! > 60, 'must wait for the hour window, not just a minute');
});

test('visitors are counted separately', async () => {
  for (let i = 0; i < 6; i++) await limitRequest(req('1.1.1.1'), 'chat', T0);
  await rejection(limitRequest(req('1.1.1.1'), 'chat', T0));
  await limitRequest(req('9.9.9.9'), 'chat', T0); // a different visitor is unaffected
});

test('policies are counted separately (chat does not use up search)', async () => {
  for (let i = 0; i < 6; i++) await limitRequest(req('1.1.1.1'), 'chat', T0);
  await rejection(limitRequest(req('1.1.1.1'), 'chat', T0));
  await limitRequest(req('1.1.1.1'), 'search', T0);
  await limitRequest(req('1.1.1.1'), 'lookup', T0);
});

test('global daily cap stops everyone, whatever their address', async () => {
  process.env.GLOBAL_DAILY_CHAT_LIMIT = '2';
  await limitRequest(req('3.3.3.1'), 'chat', T0);
  await limitRequest(req('3.3.3.2'), 'chat', T0);
  const err = await rejection(limitRequest(req('3.3.3.3'), 'chat', T0));
  assert.equal(err.status, 429);
  assert.equal(err.code, 'DAILY_LIMIT_REACHED');
  assert.ok(err.retryAfter! > 3600);
  await limitRequest(req('3.3.3.3'), 'search', T0); // the cap only covers chat
});

test('an invalid GLOBAL_DAILY_CHAT_LIMIT falls back to the default instead of disabling the cap', async () => {
  for (const bad of ['abc', '0', '-5', '']) {
    process.env.GLOBAL_DAILY_CHAT_LIMIT = bad;
    setRateLimitStore(createMemoryStore());
    for (let i = 0; i < 6; i++) await limitRequest(req('4.4.4.4'), 'chat', T0);
    // not rejected by a bogus cap of 0 (default is 100), only by the per-minute rule
    assert.equal((await rejection(limitRequest(req('4.4.4.4'), 'chat', T0))).code, 'RATE_LIMITED', bad);
  }
});

test('IP addresses are never stored in the clear; counters expire after their window', async () => {
  const seen: { key: string; expiresAt: Date }[] = [];
  const recording: RateLimitStore = {
    async increment(key, expiresAt) {
      seen.push({ key, expiresAt });
      return 1;
    },
  };
  setRateLimitStore(recording);
  await limitRequest(req('203.0.113.77'), 'chat', T0);
  assert.equal(seen.length, 3); // minute + hour + global day
  for (const { key, expiresAt } of seen) {
    assert.ok(!key.includes('203.0.113.77'), key);
    assert.ok(expiresAt.getTime() > T0.getTime());
  }
  assert.ok(seen.some((s) => s.key.includes('|global|')));
  // the same visitor produces the same keys again; a different visitor does not
  const firstRun = seen.map((s) => s.key);
  seen.length = 0;
  await limitRequest(req('203.0.113.77'), 'chat', T0);
  await limitRequest(req('203.0.113.78'), 'chat', T0);
  const sameVisitor = seen.slice(0, 3).map((s) => s.key);
  const otherVisitor = seen.slice(3, 6).map((s) => s.key);
  assert.deepEqual(sameVisitor, firstRun);
  assert.notEqual(otherVisitor[0], firstRun[0]); // per-visitor (minute) key differs
  assert.notEqual(otherVisitor[1], firstRun[1]); // per-visitor (hour) key differs
  assert.equal(otherVisitor[2], firstRun[2]); // the global daily key is shared by everyone
});

test('on Vercel a missing RATE_LIMIT_SALT is a loud error, locally it is not', async () => {
  delete process.env.RATE_LIMIT_SALT;
  process.env.VERCEL = '1';
  await assert.rejects(limitRequest(req('1.1.1.1'), 'search', T0), /RATE_LIMIT_SALT/);
  delete process.env.VERCEL;
  await limitRequest(req('1.1.1.1'), 'search', T0);
});

test('different salts give different keys (the salt is really used)', async () => {
  const keys: string[] = [];
  setRateLimitStore({ increment: async (key) => (keys.push(key), 1) });
  process.env.RATE_LIMIT_SALT = 'salt-one';
  await limitRequest(req('1.1.1.1'), 'search', T0);
  process.env.RATE_LIMIT_SALT = 'salt-two';
  await limitRequest(req('1.1.1.1'), 'search', T0);
  assert.notEqual(keys[0], keys[1]);
});

test('if the counter store fails, the request is refused (fail closed), not waved through', async () => {
  setRateLimitStore({ increment: async () => { throw new Error('database down'); } });
  await assert.rejects(limitRequest(req('1.1.1.1'), 'chat', T0), /database down/);
});

test('clientIp: platform headers win, then fall back, never throws', () => {
  const r = (h: Record<string, string>) => clientIp(new Request('http://t', { headers: h }));
  assert.equal(r({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }), '1.1.1.1');
  assert.equal(r({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' }), '2.2.2.2');
  assert.equal(r({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }), '3.3.3.3');
  assert.equal(r({}), 'unknown');
});

test('the chat endpoint returns 429 with a Retry-After header and refuses before reading the body', async () => {
  const statuses: number[] = [];
  let limited: Response | undefined;
  for (let i = 0; i < 14 && !limited; i++) {
    const res = await chat(new Request('http://test/api/chat', { method: 'POST', headers: { 'x-real-ip': '5.5.5.5' }, body: '{}' }));
    statuses.push(res.status);
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, `never rate limited: ${statuses}`);
  assert.ok(statuses.slice(0, -1).every((s) => s === 400), `earlier requests should reach validation (400): ${statuses}`);
  assert.ok(statuses.length <= 14);
  const retryAfter = Number(limited.headers.get('Retry-After'));
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, String(retryAfter));
  assert.equal(limited.headers.get('Cache-Control'), 'no-store');
  const body = (await limited.json()) as { code: string; error: string };
  assert.equal(body.code, 'RATE_LIMITED');
  assert.ok(!/gemini|quota|google/i.test(body.error));
});

test('wrong-method requests are rejected with 405 before they use any rate-limit budget', async () => {
  for (let i = 0; i < 10; i++) {
    const res = await chatGet(new Request('http://test/api/chat', { headers: { 'x-real-ip': '6.6.6.6' } }));
    assert.equal(res.status, 405);
  }
  // the same visitor still has their full allowance for real requests
  const res = await chat(new Request('http://test/api/chat', { method: 'POST', headers: { 'x-real-ip': '6.6.6.6' }, body: '{}' }));
  assert.equal(res.status, 400);
});
