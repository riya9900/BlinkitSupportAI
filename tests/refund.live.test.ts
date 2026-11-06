// Integration tests for the refund endpoints against the seeded MongoDB.
// Needs .env, seeded data and `npm run db:indexes`. Run: npm run test:live
//
// The ONE write these tests make is a refund on ORD1001. The `after` hook
// deletes exactly the refund ids the tests created, so seed data is untouched.
import './noRateLimit.js'; // these tests are not about rate limiting
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { POST as eligibility } from '../api/refund-eligibility.js';
import { POST as refundRequest, GET as refundRequestGet } from '../api/refund-request.js';
import { POST as refundStatus } from '../api/refund-status.js';
import { closeDb, collections } from '../lib/db.js';

const createdRefundIds: string[] = [];

after(async () => {
  if (createdRefundIds.length > 0) {
    await (await collections.refunds()).deleteMany({ _id: { $in: createdRefundIds } });
  }
  await closeDb();
});

type Handler = (r: Request) => Promise<Response>;
const call = (handler: Handler, body: unknown) =>
  handler(new Request('http://test/api', { method: 'POST', body: JSON.stringify(body) }));
// Reads JSON; tests below assert on the fields they care about.
const read = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const C1 = '9000000001'; // owner of ORD1001, ORD1002
const C2 = '9000000002'; // owner of ORD1003, ORD1004

test('eligibility: ORD1001 (delivered 2h ago) is eligible and creates nothing', async () => {
  const body = await read(await call(eligibility, { orderId: 'ORD1001', phone: C1 }));
  assert.equal(body.eligible, true);
  assert.equal(body.maxAmount, 111);
  const status = await read(await call(refundStatus, { orderId: 'ORD1001', phone: C1 }));
  assert.equal(status.count, 0);
});

test('eligibility: each seeded scenario gives the expected answer', async () => {
  const cases: [string, string, string][] = [
    ['ORD1002', C1, 'ORDER_NOT_DELIVERED'],
    ['ORD1003', C2, 'WINDOW_EXPIRED'],
    ['ORD1004', C2, 'ALREADY_REQUESTED'],
  ];
  for (const [orderId, phone, code] of cases) {
    const body = await read(await call(eligibility, { orderId, phone }));
    assert.equal(body.eligible, false, orderId);
    assert.equal(body.code, code, orderId);
  }
  const cancelled = await read(await call(eligibility, { orderId: 'ORD1005', phone: '9000000003' }));
  assert.equal(cancelled.code, 'ORDER_CANCELLED');
});

test('refund-request: wrong phone and unknown order give 404; bad input gives 400', async () => {
  const reason = 'Item was damaged';
  assert.equal((await call(refundRequest, { orderId: 'ORD1001', phone: C2, reason })).status, 404);
  assert.equal((await call(refundRequest, { orderId: 'ORD9999', phone: C1, reason })).status, 404);
  assert.equal((await call(refundRequest, { orderId: 'ORD1001', phone: C1 })).status, 400);
  assert.equal((await call(refundRequest, { orderId: 'ORD1001', phone: C1, reason: 'hi' })).status, 400);
  assert.equal((await call(refundRequest, { orderId: 'ORD1001', phone: C1, reason, amount: '50' })).status, 400);
  assert.equal((await call(refundRequest, { orderId: 'ORD1001', phone: C1, reason, amount: -1 })).status, 400);
  assert.equal((await refundRequestGet(new Request('http://test/api'))).status, 405);
});

test('refund-request: ineligible orders are refused (422/409) and nothing is saved', async () => {
  const reason = 'Item was damaged';
  const notDelivered = await call(refundRequest, { orderId: 'ORD1002', phone: C1, reason });
  assert.equal(notDelivered.status, 422);
  assert.equal((await read(notDelivered)).code, 'ORDER_NOT_DELIVERED');
  assert.equal((await call(refundRequest, { orderId: 'ORD1003', phone: C2, reason })).status, 422);
  assert.equal((await call(refundRequest, { orderId: 'ORD1004', phone: C2, reason })).status, 409);
  const tooMuch = await call(refundRequest, { orderId: 'ORD1001', phone: C1, reason, amount: 999 });
  assert.equal(tooMuch.status, 422);
  assert.equal((await read(tooMuch)).code, 'AMOUNT_EXCEEDS_ORDER');

  const count = await (await collections.refunds()).countDocuments({ orderId: { $in: ['ORD1001', 'ORD1002', 'ORD1003'] } });
  assert.equal(count, 0);
});

test('refund-request: a valid request is created, auto-approved, then cannot be repeated', async () => {
  const reason = 'Milk packet was leaking';
  const res = await call(refundRequest, { orderId: 'ORD1001', phone: C1, reason, amount: 66 });
  assert.equal(res.status, 201);
  const { refund } = await read(res);
  createdRefundIds.push(refund.refundId);
  assert.equal(refund.status, 'approved');
  assert.equal(refund.amount, 66);

  const status = await read(await call(refundStatus, { orderId: 'ORD1001', phone: C1 }));
  assert.equal(status.count, 1);
  assert.equal(status.refunds[0].refundId, refund.refundId);

  const again = await call(refundRequest, { orderId: 'ORD1001', phone: C1, reason });
  assert.equal(again.status, 409);
  assert.equal((await read(again)).code, 'ALREADY_REQUESTED');
});

test('refund-request: two simultaneous requests create only one refund (database index)', async () => {
  // ORD1001 currently has an approved refund from the previous test; remove it
  // first (our own record) so this test starts from a clean state.
  await (await collections.refunds()).deleteMany({ _id: { $in: createdRefundIds } });
  createdRefundIds.length = 0;

  const reason = 'Bread was stale';
  const results = await Promise.all([
    call(refundRequest, { orderId: 'ORD1001', phone: C1, reason }),
    call(refundRequest, { orderId: 'ORD1001', phone: C1, reason }),
    call(refundRequest, { orderId: 'ORD1001', phone: C1, reason }),
  ]);
  const bodies = await Promise.all(results.map(read));
  for (const b of bodies) if (b.refund) createdRefundIds.push(b.refund.refundId);

  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409]);
  const count = await (await collections.refunds()).countDocuments({ orderId: 'ORD1001' });
  assert.equal(count, 1);
});
