// Refund service: connects the pure rules (refundRules.ts) to the database.
// This is the ONLY place that creates refund records, and it only does so
// after the rules say the request is eligible.
import { randomBytes } from 'node:crypto';
import { collections } from './db.js';
import { HttpError } from './http.js';
import { findOwnedOrder } from './orders.js';
import { evaluateRefund, type RefundDecision } from './refundRules.js';
import type { Order, Refund } from './types.js';
import type { RefundRequestInput } from './validation.js';

const NOT_FOUND = 'No order found with that order ID and phone number.';

async function loadOrderAndRefunds(orderId: string, phone: string) {
  const order = await findOwnedOrder(orderId, phone);
  if (!order) throw new HttpError(404, NOT_FOUND);
  const refunds = await (await collections.refunds()).find({ orderId: order._id }).toArray();
  return { order, refunds };
}

// Read-only: "could this order be refunded right now?"
export async function checkRefundEligibility(
  orderId: string,
  phone: string,
  now = new Date(),
): Promise<{ order: Order; decision: RefundDecision }> {
  const { order, refunds } = await loadOrderAndRefunds(orderId, phone);
  return { order, decision: evaluateRefund(order, refunds, undefined, now) };
}

// Creates a refund record if (and only if) the rules allow it.
export async function requestRefund(input: RefundRequestInput, now = new Date()): Promise<Refund> {
  const { order, refunds } = await loadOrderAndRefunds(input.orderId, input.phone);
  const decision = evaluateRefund(order, refunds, input.amount, now);

  if (!decision.eligible) {
    const status = decision.code === 'ALREADY_REQUESTED' ? 409 : 422;
    throw new HttpError(status, decision.message, decision.code);
  }

  const refund: Refund = {
    _id: `REF${randomBytes(4).toString('hex').toUpperCase()}`,
    orderId: order._id,
    customerId: order.customerId,
    reason: input.reason,
    amount: decision.amount,
    status: decision.status,
    decisionNote:
      decision.status === 'approved'
        ? 'Auto-approved by policy.'
        : 'Awaiting human review (amount above auto-approval limit).',
    createdAt: now,
  };

  try {
    await (await collections.refunds()).insertOne(refund);
  } catch (err) {
    // 11000 = duplicate key: the unique index caught a simultaneous request.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      throw new HttpError(409, 'A refund has already been requested for this order.', 'ALREADY_REQUESTED');
    }
    throw err;
  }
  return refund;
}

// Read-only: refunds already filed for this order.
export async function getRefundStatus(orderId: string, phone: string) {
  const { refunds } = await loadOrderAndRefunds(orderId, phone);
  return refunds.map((r) => ({
    refundId: r._id,
    amount: r.amount,
    status: r.status,
    reason: r.reason,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  }));
}
