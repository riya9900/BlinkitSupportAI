// POST /api/order-status   body: { "orderId": "ORD1001", "phone": "9000000001" }
// Uses POST (not GET) so the phone number never appears in a URL.
import { handle, HttpError, json, readJsonBody, requireMethod } from '../lib/http.js';
import { getOrderStatus } from '../lib/orders.js';
import { parseOrderStatusInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'lookup');
  const input = parseOrderStatusInput(await readJsonBody(request));
  const order = await getOrderStatus(input.orderId, input.phone);
  if (!order) {
    throw new HttpError(404, 'No order found with that order ID and phone number.');
  }
  return json({ order });
});

// Any other HTTP method gets a clean 405 instead of a platform error.
const methodNotAllowed = handle(async (request) => {
  requireMethod(request, 'POST');
  return json({});
});
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
