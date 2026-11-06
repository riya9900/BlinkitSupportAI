// POST /api/chat
// body: { "messages": [ { "role": "user", "text": "Where is my order ORD1002? Phone 9000000001" } ] }
// The browser sends the whole conversation each time; the server keeps no state.
// Response: { "reply": "...", "toolCalls": [ { "name": "get_order_status", "ok": true } ] }
import { runAgent } from '../lib/agent.js';
import { executeTool } from '../lib/agentTools.js';
import { generateWithGemini } from '../lib/gemini.js';
import { handle, json, readJsonBody, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { parseChatInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const POST = handle(async (request) => {
  requireMethod(request, 'POST');
  await limitRequest(request, 'chat');
  const messages = parseChatInput(await readJsonBody(request));
  const result = await runAgent(messages, generateWithGemini, (name, args) => executeTool(name, args));
  return json(result);
});

const wrongMethod = rejectOtherMethods('POST');
export const GET = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
