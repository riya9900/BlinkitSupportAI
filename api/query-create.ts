// POST /api/query-create
// body: { "phone": "9000000003", "type": "complaint", "subject": "Late delivery",
//         "message": "My order arrived an hour late.", "orderId": "ORD1006" }   (orderId optional)
// WRITES a record to the "queries" collection.
import { handle, json, readJsonBody, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { createQuery } from '../lib/support.js';
import { parseQueryInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'write');
  const query = await createQuery(parseQueryInput(await readJsonBody(request)));
  return json(
    {
      query: {
        queryId: query._id,
        type: query.type,
        subject: query.subject,
        orderId: query.orderId,
        status: query.status,
      },
    },
    201,
  );
});

const wrongMethod = rejectOtherMethods('POST');
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
