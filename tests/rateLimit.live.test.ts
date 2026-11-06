// The REAL MongoDB rate-limit store. Needs .env and `npm run db:indexes`. Run: npm run test:live
// Uses keys that start with "test|" and deletes exactly those afterwards.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb, collections } from '../lib/db.js';
import { mongoStore } from '../lib/rateLimit.js';

const prefix = `test|${Date.now()}|`;
const farFuture = () => new Date(Date.now() + 3_600_000);

after(async () => {
  await (await collections.rateLimits()).deleteMany({ _id: { $regex: `^${prefix.replace(/\|/g, '\\|')}` } });
  await closeDb();
});

test('mongo store: counts 1, 2, 3 on one key and keeps keys separate', async () => {
  assert.equal(await mongoStore.increment(`${prefix}a`, farFuture()), 1);
  assert.equal(await mongoStore.increment(`${prefix}a`, farFuture()), 2);
  assert.equal(await mongoStore.increment(`${prefix}a`, farFuture()), 3);
  assert.equal(await mongoStore.increment(`${prefix}b`, farFuture()), 1);
});

test('mongo store: 15 simultaneous increments on a brand-new key never lose or repeat a count', async () => {
  const counts = await Promise.all(Array.from({ length: 15 }, () => mongoStore.increment(`${prefix}race`, farFuture())));
  assert.deepEqual([...counts].sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i + 1));
});

test('mongo store: the TTL index that cleans up expired counters exists', async () => {
  const indexes = await (await collections.rateLimits()).indexes();
  const ttl = indexes.find((i) => i.name === 'ratelimit_ttl');
  assert.ok(ttl, 'run `npm run db:indexes` to create it');
  assert.equal(ttl.expireAfterSeconds, 0);
});

test('mongo store: the stored counter holds no IP address, only the key and an expiry', async () => {
  const doc = await (await collections.rateLimits()).findOne({ _id: `${prefix}a` });
  assert.deepEqual(Object.keys(doc ?? {}).sort(), ['_id', 'count', 'expiresAt']);
});
