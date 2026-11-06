// Business logic for order lookups. Reads the database only; never writes.
import { collections } from './db.js';
import type { Order, OrderItem, OrderStatus } from './types.js';

const STATUS_LABELS: Record<OrderStatus, string> = {
  placed: 'Order placed, preparing for packing',
  packed: 'Packed and waiting for a delivery partner',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export interface OrderStatusResult {
  orderId: string;
  status: OrderStatus;
  statusLabel: string;
  items: OrderItem[];
  total: number;
  paymentMethod: string;
  placedAt: Date;
  deliveredAt?: Date;
}

// The customer must supply the phone number registered on the order. If the
// order does not exist OR the phone does not match, we return null in both
// cases so nobody can probe which order numbers exist.
export async function findOwnedOrder(orderId: string, phone: string): Promise<Order | null> {
  const order = await (await collections.orders()).findOne({ _id: orderId });
  if (!order) return null;

  const customer = await (await collections.customers()).findOne({ _id: order.customerId });
  if (!customer || customer.phone !== phone) return null;

  return order;
}

export async function getOrderStatus(
  orderId: string,
  phone: string,
): Promise<OrderStatusResult | null> {
  const order = await findOwnedOrder(orderId, phone);
  if (!order) return null;

  return {
    orderId: order._id,
    status: order.status,
    statusLabel: STATUS_LABELS[order.status],
    items: order.items,
    total: order.total,
    paymentMethod: order.paymentMethod,
    placedAt: order.placedAt,
    deliveredAt: order.deliveredAt,
  };
}
