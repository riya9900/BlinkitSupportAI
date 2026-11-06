// Integration tests for the query and handoff endpoints against the seeded MongoDB.
// Needs .env, seeded data and `npm run db:indexes`. Run: npm run test:live
//
// These tests WRITE to "queries" and "handoffs". The `after` hook deletes exactly
// the ids the tests created, so the collections end up as they started.
import './noRateLimit.js'; // these tests are not about rate limiting
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { POST as handoffCreate, GET as handoffCreateGet } from '../api/handoff-create.js';
import { POST as queryCreate } from '../api/query-create.js';
import { closeDb, collections } from '../lib/db.js';
import { MAX_OPEN_QUERIES } from '../lib/support.js';

const queryIds: string[] = [];
const handoffIds: string[] = [];

after(async () => {
  if (queryIds.length) await (await collections.queries()).deleteMany({ _id: { $in: queryIds } });
  if (handoffIds.length) await (await collections.handoffs()).deleteMany({ _id: { $in: handoffIds } });
  await closeDb();
});

type Handler = (r: Request) => Promise<Response>;
const call = (handler: Handler, body: unknown) =>
  handler(new Request('http://test/api', { method: 'POST', body: JSON.stringify(body) }));
const read = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const C3 = '9000000003'; // owns ORD1005, ORD1006
const C1 = '9000000001'; // owns ORD1001, ORD1002
const C2 = '9000000002';

const complaint = (extra: object = {}) => ({
  phone: C3,
  type: 'complaint',
  subject: 'Late delivery',
  message: 'My order arrived an hour late.',
  ...extra,
});

test('query: a valid complaint with an owned order is saved as open', async () => {
  const res = await call(queryCreate, complaint({ orderId: 'ORD1006' }));
  assert.equal(res.status, 201);
  const { query } = await read(res);
  queryIds.push(query.queryId);
  assert.equal(query.status, 'open');
  assert.equal(query.orderId, 'ORD1006');

  const saved = await (await collections.queries()).findOne({ _id: query.queryId });
  assert.equal(saved?.customerId, 'CUST003');
  assert.equal(saved?.type, 'complaint');
  assert.equal(saved?.message, 'My order arrived an hour late.');
});

test('query: a general query without an order is saved', async () => {
  const res = await call(queryCreate, complaint({ type: 'query', subject: 'Delivery hours' }));
  assert.equal(res.status, 201);
  const { query } = await read(res);
  queryIds.push(query.queryId);
  assert.equal(query.orderId, undefined);
});

test('query: unknown phone and someone else\'s order give the same 404; bad input is 400', async () => {
  const unknownPhone = await call(queryCreate, complaint({ phone: '9999999999' }));
  const notYourOrder = await call(queryCreate, complaint({ orderId: 'ORD1001' })); // belongs to CUST001
  const noSuchOrder = await call(queryCreate, complaint({ orderId: 'ORD9999' }));
  assert.equal(unknownPhone.status, 404);
  assert.deepEqual(await read(unknownPhone), await read(notYourOrder));
  assert.equal(noSuchOrder.status, 404);
  assert.equal((await call(queryCreate, complaint({ type: 'praise' }))).status, 400);
  assert.equal((await call(queryCreate, complaint({ message: 'short' }))).status, 400);
});

test('query: more than the open-query limit is refused with 429', async () => {
  const col = await collections.queries();
  const alreadyOpen = await col.countDocuments({ customerId: 'CUST002', status: 'open' });
  for (let i = alreadyOpen; i < MAX_OPEN_QUERIES; i++) {
    const res = await call(queryCreate, complaint({ phone: C2, subject: `Issue number ${i}` }));
    assert.equal(res.status, 201);
    queryIds.push((await read(res)).query.queryId);
  }
  const over = await call(queryCreate, complaint({ phone: C2 }));
  assert.equal(over.status, 429);
  assert.equal((await read(over)).code, 'TOO_MANY_OPEN_QUERIES');
});

const handoffBody = (extra: object = {}) => ({
  phone: C1,
  reason: 'Customer wants to speak to a person',
  conversationSummary: 'Customer asked about ORD1001 refund twice and is frustrated.',
  ...extra,
});

test('handoff: created as waiting, saved with the summary, repeat returns the same one', async () => {
  const res = await call(handoffCreate, handoffBody({ orderId: 'ORD1001' }));
  assert.equal(res.status, 201);
  const first = await read(res);
  handoffIds.push(first.handoff.handoffId);
  assert.equal(first.created, true);
  assert.equal(first.handoff.status, 'waiting');

  const saved = await (await collections.handoffs()).findOne({ _id: first.handoff.handoffId });
  assert.equal(saved?.customerId, 'CUST001');
  assert.match(saved?.conversationSummary ?? '', /ORD1001 refund/);

  const again = await call(handoffCreate, handoffBody());
  assert.equal(again.status, 200);
  const second = await read(again);
  assert.equal(second.created, false);
  assert.equal(second.handoff.handoffId, first.handoff.handoffId);
  assert.equal(await (await collections.handoffs()).countDocuments({ customerId: 'CUST001' }), 1);
});

test('handoff: a resolved handoff does not block a new one', async () => {
  const col = await collections.handoffs();
  await col.updateOne({ _id: handoffIds[0] }, { $set: { status: 'resolved' } }); // our own test record
  const res = await call(handoffCreate, handoffBody());
  assert.equal(res.status, 201);
  handoffIds.push((await read(res)).handoff.handoffId);
});

test('handoff: unknown phone 404, bad input 400, GET 405', async () => {
  assert.equal((await call(handoffCreate, handoffBody({ phone: '9999999999' }))).status, 404);
  assert.equal((await call(handoffCreate, handoffBody({ orderId: 'ORD1005' }))).status, 404); // not C1's order
  assert.equal((await call(handoffCreate, handoffBody({ reason: 'no' }))).status, 400);
  assert.equal((await handoffCreateGet(new Request('http://test/api'))).status, 405);
});

test('handoff: simultaneous requests for one customer create only one active handoff', async () => {
  // Start clean: resolve only handoffs that THESE tests created earlier.
  const col = await collections.handoffs();
  await col.updateMany({ _id: { $in: handoffIds }, customerId: 'CUST002' }, { $set: { status: 'resolved' } });
  assert.equal(await col.countDocuments({ customerId: 'CUST002', status: { $in: ['waiting', 'assigned'] } }), 0);
  const results = await Promise.all([1, 2, 3].map(() => call(handoffCreate, handoffBody({ phone: C2 }))));
  const bodies = await Promise.all(results.map(read));
  for (const b of bodies) handoffIds.push(b.handoff.handoffId);

  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 201]);
  assert.equal(new Set(bodies.map((b) => b.handoff.handoffId)).size, 1);
  const active = await col.countDocuments({ customerId: 'CUST002', status: { $in: ['waiting', 'assigned'] } });
  assert.equal(active, 1);
});
