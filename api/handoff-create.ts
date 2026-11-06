// POST /api/handoff-create
// body: { "phone": "9000000003", "reason": "Customer is upset about repeated delays",
//         "conversationSummary": "Asked about ORD1006 three times...", "orderId": "ORD1006" }
// Puts the customer in the human-agent queue. WRITES to the "handoffs" collection.
// 201 = new handoff created, 200 = the customer already had an active one (returned as-is).
import { handle, json, readJsonBody, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { createHandoff } from '../lib/support.js';
import { parseHandoffInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'write');
  const { handoff, created } = await createHandoff(parseHandoffInput(await readJsonBody(request)));
  return json(
    {
      created,
      handoff: {
        handoffId: handoff._id,
        status: handoff.status,
        orderId: handoff.orderId,
        reason: handoff.reason,
      },
      message: created
        ? 'A human agent has been requested and will contact you soon.'
        : 'You are already in the queue for a human agent.',
    },
    created ? 201 : 200,
  );
});

const wrongMethod = rejectOtherMethods('POST');
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
