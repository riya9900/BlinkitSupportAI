// POST /api/refund-eligibility   body: { "orderId": "ORD1001", "phone": "9000000001" }
// Read-only. Tells whether the order could be refunded right now. Creates nothing.
import { handle, json, readJsonBody, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { checkRefundEligibility } from '../lib/refunds.js';
import { parseOrderStatusInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'lookup');
  const input = parseOrderStatusInput(await readJsonBody(request));
  const { order, decision } = await checkRefundEligibility(input.orderId, input.phone);
  return json({ orderId: order._id, ...decision });
});

const wrongMethod = rejectOtherMethods('POST');
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
