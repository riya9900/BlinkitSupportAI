// Unit tests for the refund rules. No database needed. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_APPROVE_LIMIT, evaluateRefund, REFUND_WINDOW_HOURS } from '../lib/refundRules.js';
import type { Order, Refund } from '../lib/types.js';

const NOW = new Date('2026-01-10T12:00:00Z');
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    _id: 'ORD1001',
    customerId: 'CUST001',
    items: [],
    total: 111,
    status: 'delivered',
    paymentMethod: 'upi',
    placedAt: hoursBefore(5),
    deliveredAt: hoursBefore(2),
    ...overrides,
  };
}

function makeRefund(status: Refund['status']): Refund {
  return {
    _id: 'REF1',
    orderId: 'ORD1001',
    customerId: 'CUST001',
    reason: 'test',
    amount: 10,
    status,
    decisionNote: '',
    createdAt: hoursBefore(1),
  };
}

const rejected = (d: ReturnType<typeof evaluateRefund>) => {
  assert.equal(d.eligible, false);
  return d.eligible ? '' : d.code;
};

test('delivered recently, no refunds: eligible, full amount, auto-approved', () => {
  const d = evaluateRefund(makeOrder(), [], undefined, NOW);
  assert.equal(d.eligible, true);
  if (d.eligible) {
    assert.equal(d.amount, 111);
    assert.equal(d.maxAmount, 111);
    assert.equal(d.status, 'approved');
  }
});

test('order not delivered yet is rejected', () => {
  for (const status of ['placed', 'packed', 'out_for_delivery'] as const) {
    const order = makeOrder({ status, deliveredAt: undefined });
    assert.equal(rejected(evaluateRefund(order, [], undefined, NOW)), 'ORDER_NOT_DELIVERED');
  }
});

test('delivered status but missing deliveredAt is rejected (bad data is not trusted)', () => {
  const order = makeOrder({ deliveredAt: undefined });
  assert.equal(rejected(evaluateRefund(order, [], undefined, NOW)), 'ORDER_NOT_DELIVERED');
});

test('cancelled order is rejected', () => {
  const order = makeOrder({ status: 'cancelled', deliveredAt: undefined });
  assert.equal(rejected(evaluateRefund(order, [], undefined, NOW)), 'ORDER_CANCELLED');
});

test('refund window boundary: exactly at the limit is ok, just past it is not', () => {
  const atLimit = makeOrder({ deliveredAt: hoursBefore(REFUND_WINDOW_HOURS) });
  assert.equal(evaluateRefund(atLimit, [], undefined, NOW).eligible, true);
  const past = makeOrder({ deliveredAt: hoursBefore(REFUND_WINDOW_HOURS + 0.01) });
  assert.equal(rejected(evaluateRefund(past, [], undefined, NOW)), 'WINDOW_EXPIRED');
});

test('existing pending or approved refund blocks a new one; rejected does not', () => {
  assert.equal(rejected(evaluateRefund(makeOrder(), [makeRefund('pending')], undefined, NOW)), 'ALREADY_REQUESTED');
  assert.equal(rejected(evaluateRefund(makeOrder(), [makeRefund('approved')], undefined, NOW)), 'ALREADY_REQUESTED');
  assert.equal(evaluateRefund(makeOrder(), [makeRefund('rejected')], undefined, NOW).eligible, true);
});

test('amount rules: partial ok, above total rejected, zero/negative/NaN rejected', () => {
  const partial = evaluateRefund(makeOrder(), [], 50, NOW);
  assert.equal(partial.eligible && partial.amount, 50);
  assert.equal(rejected(evaluateRefund(makeOrder(), [], 111.01, NOW)), 'AMOUNT_EXCEEDS_ORDER');
  assert.equal(rejected(evaluateRefund(makeOrder(), [], 0, NOW)), 'INVALID_AMOUNT');
  assert.equal(rejected(evaluateRefund(makeOrder(), [], -5, NOW)), 'INVALID_AMOUNT');
  assert.equal(rejected(evaluateRefund(makeOrder(), [], Number.NaN, NOW)), 'INVALID_AMOUNT');
});

test('auto-approval limit: at the limit approved, above it pending human review', () => {
  const big = makeOrder({ total: 500 });
  const atLimit = evaluateRefund(big, [], AUTO_APPROVE_LIMIT, NOW);
  assert.equal(atLimit.eligible && atLimit.status, 'approved');
  const above = evaluateRefund(big, [], AUTO_APPROVE_LIMIT + 1, NOW);
  assert.equal(above.eligible && above.status, 'pending');
  const full = evaluateRefund(big, [], undefined, NOW);
  assert.equal(full.eligible && full.status, 'pending');
});
