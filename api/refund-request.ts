// POST /api/refund-request
// body: { "orderId": "ORD1001", "phone": "9000000001", "reason": "Milk was spoiled", "amount": 66 }
// "amount" is optional (defaults to the full order total).
// WRITES a refund record, but only if the backend rules allow it.
import { handle, json, readJsonBody, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { requestRefund } from '../lib/refunds.js';
import { parseRefundRequestInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'write');
  const input = parseRefundRequestInput(await readJsonBody(request));
  const refund = await requestRefund(input);
  return json(
    {
      refund: {
        refundId: refund._id,
        orderId: refund.orderId,
        amount: refund.amount,
        status: refund.status,
        decisionNote: refund.decisionNote,
      },
    },
    201,
  );
});

const wrongMethod = rejectOtherMethods('POST');
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
