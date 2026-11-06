// The only place the browser talks to our backend. The browser never sees an
// API key or database password: it just calls /api/chat on our own server.
import { friendlyError, type ApiMessage, type ToolCallInfo } from './chatLogic';

export interface ChatReply {
  reply: string;
  toolCalls: ToolCallInfo[];
}

export class ChatApiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

const REQUEST_TIMEOUT_MS = 60_000;

export async function sendChat(messages: ApiMessage[], signal: AbortSignal): Promise<ChatReply> {
  // Time out after 60 seconds, or earlier if the caller cancels.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);

  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: combined,
    });
  } catch (err) {
    if (signal.aborted) throw err; // the caller cancelled on purpose
    const { text, retryable } = friendlyError(null);
    throw new ChatApiError(text, retryable);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const serverMessage =
      typeof (body as { error?: unknown } | undefined)?.error === 'string'
        ? (body as { error: string }).error
        : undefined;
    const { text, retryable } = friendlyError(response.status, serverMessage);
    throw new ChatApiError(text, retryable);
  }

  // Don't trust the shape blindly.
  const data = body as Partial<ChatReply> | undefined;
  if (typeof data?.reply !== 'string' || !Array.isArray(data.toolCalls)) {
    const { text, retryable } = friendlyError(500);
    throw new ChatApiError(text, retryable);
  }
  return {
    reply: data.reply,
    toolCalls: data.toolCalls.filter(
      (t): t is ToolCallInfo => typeof t?.name === 'string' && typeof t?.ok === 'boolean',
    ),
  };
}
