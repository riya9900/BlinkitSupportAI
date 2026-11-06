// POST /api/refund-status   body: { "orderId": "ORD1004", "phone": "9000000002" }
// Read-only. Lists refunds already filed for the order.
import { handle, json, readJsonBody, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { getRefundStatus } from '../lib/refunds.js';
import { parseOrderStatusInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'lookup');
  const input = parseOrderStatusInput(await readJsonBody(request));
  const refunds = await getRefundStatus(input.orderId, input.phone);
  return json({ orderId: input.orderId, count: refunds.length, refunds });
});

const wrongMethod = rejectOtherMethods('POST');
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
