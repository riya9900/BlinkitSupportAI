// Tests for the local test-data helper. No database. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateRefund } from '../lib/refundRules.js';
import type { Order, Refund } from '../lib/types.js';
import { orders, refunds as seedRefunds } from '../scripts/seedData.js';
import { assertSeedAllowed, assertTestDatabase, planDelivery } from '../scripts/testOrderTools.js';

const ord = (id: string): Order => structuredClone(orders.find((o) => o._id === id)!);
const now = new Date('2026-11-07T08:30:00Z');

test('guard: refuses the production database name, allows local/test names', () => {
  assert.throws(() => assertTestDatabase('blinkit_support'), /Refusing to run/);
  assert.throws(() => assertTestDatabase('production'), /Refusing to run/);
  assert.doesNotThrow(() => assertTestDatabase('blinkit_support_local'));
  assert.doesNotThrow(() => assertTestDatabase('blinkit_test'));
});

test('seed ORD1002 is out for delivery and NOT refundable until delivered', () => {
  const order = ord('ORD1002');
  assert.equal(order.status, 'out_for_delivery');
  const d = evaluateRefund(order, [], undefined, now);
  assert.equal(d.eligible, false);
  if (!d.eligible) assert.equal(d.code, 'ORDER_NOT_DELIVERED');
});

test('status alone is not enough: the real rules also need deliveredAt', () => {
  const order = { ...ord('ORD1002'), status: 'delivered' as const }; // no deliveredAt
  const d = evaluateRefund(order, [], undefined, now);
  assert.equal(d.eligible, false);
});

test('planDelivery sets status AND deliveredAt, and the unchanged real rules then say eligible', () => {
  const order = ord('ORD1002');
  const plan = planDelivery(order, [], now);
  assert.deepEqual(plan.set, { status: 'delivered', deliveredAt: now });
  assert.deepEqual(plan.warnings, []);
  const d = evaluateRefund({ ...order, ...plan.set }, [], undefined, now);
  assert.equal(d.eligible, true);
  if (d.eligible) assert.equal(d.status, 'approved'); // Rs 120 is under the auto-approve limit
});

test('planDelivery: missing or cancelled orders are refused; an existing refund is warned about', () => {
  assert.throws(() => planDelivery(null, [], now), /does not exist/);
  assert.throws(() => planDelivery(ord('ORD1005'), [], now), /cancelled/);
  const plan = planDelivery(ord('ORD1004'), seedRefunds, now);
  assert.match(plan.warnings.join(' '), /ALREADY_REQUESTED/);
  const refund: Refund = seedRefunds[0];
  const d = evaluateRefund({ ...ord('ORD1004'), ...plan.set }, [refund], undefined, now);
  assert.equal(d.eligible, false); // rules still block a second refund
});

test('seed guard (every seed run, not only --reset): needs MONGODB_DB set explicitly AND a local/test/dev name', () => {
  // Not set (would silently fall back to the production database): refused.
  assert.throws(() => assertSeedAllowed(undefined), /MONGODB_DB is not set/);
  assert.throws(() => assertSeedAllowed(''), /MONGODB_DB is not set/);
  // Set, but not a test database: refused. This includes the production default.
  assert.throws(() => assertSeedAllowed('blinkit_support'), /does not look like a local\/test database/);
  assert.throws(() => assertSeedAllowed('production'), /Refusing to run/);
  // Set to a test database: allowed, including when the live connection agrees.
  assert.doesNotThrow(() => assertSeedAllowed('blinkit_support_local'));
  assert.doesNotThrow(() => assertSeedAllowed('blinkit_support_local', 'blinkit_support_local'));
  // The connection is on a different database than MONGODB_DB claims: refused.
  assert.throws(() => assertSeedAllowed('blinkit_support_local', 'blinkit_support'), /connection is using/);
});
