// REFUND BUSINESS RULES. Pure functions: no database, no AI, no clock of their
// own (the current time is passed in), so they are easy to test and always
// give the same answer for the same input. Gemini can never change these.
import type { Order, Refund } from './types.js';

export const REFUND_WINDOW_HOURS = 48; // request must be within 48h of delivery
export const AUTO_APPROVE_LIMIT = 200; // rupees; above this a human reviews it

export type RefundRejectionCode =
  | 'ORDER_NOT_DELIVERED'
  | 'ORDER_CANCELLED'
  | 'WINDOW_EXPIRED'
  | 'ALREADY_REQUESTED'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_EXCEEDS_ORDER';

export type RefundDecision =
  | { eligible: false; code: RefundRejectionCode; message: string }
  | {
      eligible: true;
      amount: number; // amount that would be refunded
      maxAmount: number; // order total
      status: 'approved' | 'pending';
      message: string;
    };

const HOUR_MS = 3_600_000;

export function evaluateRefund(
  order: Order,
  existingRefunds: Refund[],
  requestedAmount: number | undefined,
  now: Date,
): RefundDecision {
  const reject = (code: RefundRejectionCode, message: string): RefundDecision => ({
    eligible: false,
    code,
    message,
  });

  if (order.status === 'cancelled') {
    return reject('ORDER_CANCELLED', 'This order was cancelled, so there is nothing to refund.');
  }
  if (order.status !== 'delivered' || !order.deliveredAt) {
    return reject(
      'ORDER_NOT_DELIVERED',
      'Refunds can only be requested after the order has been delivered.',
    );
  }

  const hoursSinceDelivery = (now.getTime() - order.deliveredAt.getTime()) / HOUR_MS;
  if (hoursSinceDelivery > REFUND_WINDOW_HOURS) {
    return reject(
      'WINDOW_EXPIRED',
      `Refunds must be requested within ${REFUND_WINDOW_HOURS} hours of delivery.`,
    );
  }

  if (existingRefunds.some((r) => r.status === 'pending' || r.status === 'approved')) {
    return reject('ALREADY_REQUESTED', 'A refund has already been requested for this order.');
  }

  const amount = requestedAmount ?? order.total;
  if (!Number.isFinite(amount) || amount <= 0) {
    return reject('INVALID_AMOUNT', 'The refund amount must be greater than zero.');
  }
  if (amount > order.total) {
    return reject(
      'AMOUNT_EXCEEDS_ORDER',
      `The refund amount cannot be more than the order total of ${order.total}.`,
    );
  }

  const status = amount <= AUTO_APPROVE_LIMIT ? 'approved' : 'pending';
  return {
    eligible: true,
    amount,
    maxAmount: order.total,
    status,
    message:
      status === 'approved'
        ? 'Eligible. The refund can be approved immediately.'
        : 'Eligible. This amount needs a human reviewer to approve it.',
  };
}
