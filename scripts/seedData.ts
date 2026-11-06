import type { Customer, Order, Product, Refund } from '../lib/types.js';

// 100% FAKE data for an academic project. Dates are relative to "now" so the
// refund-window rules (Phase 4) can be tested the same way on any day.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

export const customers: Customer[] = [
  { _id: 'CUST001', name: 'Aarav Sharma', phone: '9000000001', email: 'aarav@example.com', address: '12 Test Lane, Sample City', createdAt: hoursAgo(5000) },
  { _id: 'CUST002', name: 'Diya Patel', phone: '9000000002', email: 'diya@example.com', address: '34 Demo Road, Sample City', createdAt: hoursAgo(4000) },
  { _id: 'CUST003', name: 'Kabir Singh', phone: '9000000003', email: 'kabir@example.com', address: '56 Mock Street, Sample City', createdAt: hoursAgo(3000) },
];

export const products: Product[] = [
  { _id: 'P001', name: 'Full Cream Milk 500ml', category: 'dairy', price: 33, unit: '500 ml', inStock: true, description: 'Fresh full cream pasteurised milk.' },
  { _id: 'P002', name: 'Brown Bread 400g', category: 'bakery', price: 45, unit: '400 g', inStock: true, description: 'Whole wheat sliced bread.' },
  { _id: 'P003', name: 'Farm Eggs (6 pack)', category: 'dairy', price: 60, unit: '6 pcs', inStock: true, description: 'Fresh white eggs.' },
  { _id: 'P004', name: 'Banana (1 dozen)', category: 'fruits', price: 55, unit: '12 pcs', inStock: true, description: 'Ripe yellow bananas.' },
  { _id: 'P005', name: 'Basmati Rice 1kg', category: 'staples', price: 120, unit: '1 kg', inStock: true, description: 'Long grain aged basmati rice.' },
  { _id: 'P006', name: 'Potato Chips Classic 52g', category: 'snacks', price: 20, unit: '52 g', inStock: true, description: 'Salted potato chips.' },
  { _id: 'P007', name: 'Cola 750ml', category: 'beverages', price: 40, unit: '750 ml', inStock: false, description: 'Carbonated cola drink.' },
  { _id: 'P008', name: 'Dishwash Liquid 500ml', category: 'household', price: 99, unit: '500 ml', inStock: true, description: 'Lemon dishwashing liquid.' },
  { _id: 'P009', name: 'Tomato 1kg', category: 'vegetables', price: 30, unit: '1 kg', inStock: true, description: 'Fresh red tomatoes.' },
  { _id: 'P010', name: 'Paneer 200g', category: 'dairy', price: 85, unit: '200 g', inStock: true, description: 'Fresh cottage cheese block.' },
];

export const orders: Order[] = [
  // Delivered 2 hours ago: should be refund-eligible.
  { _id: 'ORD1001', customerId: 'CUST001', items: [{ productId: 'P001', name: 'Full Cream Milk 500ml', quantity: 2, unitPrice: 33 }, { productId: 'P002', name: 'Brown Bread 400g', quantity: 1, unitPrice: 45 }], total: 111, status: 'delivered', paymentMethod: 'upi', placedAt: hoursAgo(3), deliveredAt: hoursAgo(2) },
  // On the way: not refundable yet.
  { _id: 'ORD1002', customerId: 'CUST001', items: [{ productId: 'P005', name: 'Basmati Rice 1kg', quantity: 1, unitPrice: 120 }], total: 120, status: 'out_for_delivery', paymentMethod: 'card', placedAt: hoursAgo(0.5) },
  // Delivered 10 days ago: outside any refund window.
  { _id: 'ORD1003', customerId: 'CUST002', items: [{ productId: 'P010', name: 'Paneer 200g', quantity: 1, unitPrice: 85 }], total: 85, status: 'delivered', paymentMethod: 'cod', placedAt: hoursAgo(242), deliveredAt: hoursAgo(240) },
  // Delivered, but a refund already exists (see refunds below).
  { _id: 'ORD1004', customerId: 'CUST002', items: [{ productId: 'P003', name: 'Farm Eggs (6 pack)', quantity: 2, unitPrice: 60 }], total: 120, status: 'delivered', paymentMethod: 'upi', placedAt: hoursAgo(26), deliveredAt: hoursAgo(25) },
  // Cancelled order.
  { _id: 'ORD1005', customerId: 'CUST003', items: [{ productId: 'P006', name: 'Potato Chips Classic 52g', quantity: 3, unitPrice: 20 }], total: 60, status: 'cancelled', paymentMethod: 'upi', placedAt: hoursAgo(12) },
  // Just placed.
  { _id: 'ORD1006', customerId: 'CUST003', items: [{ productId: 'P004', name: 'Banana (1 dozen)', quantity: 1, unitPrice: 55 }, { productId: 'P009', name: 'Tomato 1kg', quantity: 1, unitPrice: 30 }], total: 85, status: 'placed', paymentMethod: 'cod', placedAt: hoursAgo(0.1) },
];

export const refunds: Refund[] = [
  { _id: 'REF0001', orderId: 'ORD1004', customerId: 'CUST002', reason: 'One egg pack was damaged', amount: 60, status: 'approved', decisionNote: 'Seed data: already refunded.', createdAt: hoursAgo(24) },
];
