// Small helpers shared by every /api endpoint.
import { logError } from './log.js';

// An error we deliberately throw to send a specific status code to the client.
export class HttpError extends Error {
  status: number;
  code?: string; // optional machine-readable reason, e.g. "WINDOW_EXPIRED"
  retryAfter?: number; // optional: seconds until the client may try again (sent as Retry-After)
  constructor(status: number, message: string, code?: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// "no-store": replies can contain order details, so browsers and proxies must never cache them.
export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

const MAX_BODY_BYTES = 10_000;

// Reads the request body as JSON. Rejects huge, empty or non-object bodies.
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) throw new HttpError(400, 'Request body is empty.');
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

export function requireMethod(request: Request, method: string): void {
  if (request.method !== method) {
    throw new HttpError(405, `Use ${method} for this endpoint.`);
  }
}

// Handler that answers 405 for every method except `allowed`.
export function rejectOtherMethods(allowed: string) {
  return handle(async (request) => {
    requireMethod(request, allowed);
    return json({});
  });
}

// Wraps a handler so expected errors become clean JSON responses and
// unexpected errors (e.g. database down) are logged but never leaked to users.
export function handle(fn: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) {
        // 4xx are the visitor's mistakes; 5xx are ours and must leave a trace in the logs.
        if (err.status >= 500) logError('api.http_error', err, { status: err.status, code: err.code });
        return json(
          err.code ? { error: err.message, code: err.code } : { error: err.message },
          err.status,
          err.retryAfter !== undefined ? { 'Retry-After': String(err.retryAfter) } : {},
        );
      }
      logError('api.unexpected_error', err, { path: new URL(request.url).pathname });
      return json({ error: 'Something went wrong on our side. Please try again.' }, 500);
    }
  };
}
