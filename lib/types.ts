// Shapes of the documents stored in each MongoDB collection.
// _id values are readable strings (e.g. "ORD1001") to make testing easy.

export type OrderStatus =
  | 'placed'
  | 'packed'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface Customer {
  _id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  createdAt: Date;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  _id: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  paymentMethod: 'upi' | 'card' | 'cod';
  placedAt: Date;
  deliveredAt?: Date;
}

export interface Product {
  _id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  inStock: boolean;
  description: string;
}

export type RefundStatus = 'pending' | 'approved' | 'rejected';

export interface Refund {
  _id: string;
  orderId: string;
  customerId: string;
  reason: string;
  amount: number;
  status: RefundStatus;
  decisionNote: string;
  createdAt: Date;
}

export interface Query {
  _id: string;
  customerId: string;
  orderId?: string;
  type: 'complaint' | 'query';
  subject: string;
  message: string;
  status: 'open' | 'closed';
  createdAt: Date;
}

// One counter per (policy, hashed client, time window). MongoDB deletes the
// document automatically once expiresAt has passed (a TTL index).
export interface RateLimitCounter {
  _id: string;
  count: number;
  expiresAt: Date;
}

export interface Handoff {
  _id: string;
  customerId: string;
  orderId?: string;
  reason: string;
  conversationSummary: string;
  status: 'waiting' | 'assigned' | 'resolved';
  createdAt: Date;
}
