// Input validation. Every value from the outside world (browser, and later
// Gemini) is checked here before it gets anywhere near the database.
import { HttpError } from './http.js';

export interface OrderStatusInput {
  orderId: string;
  phone: string;
}

export interface ProductSearchInput {
  q?: string;
  category?: string;
  inStockOnly: boolean;
  limit: number;
}

function cleanOrderId(orderId: string): string {
  const clean = orderId.trim().toUpperCase();
  if (!/^ORD\d{4,10}$/.test(clean)) throw new HttpError(400, 'orderId must look like ORD1001.');
  return clean;
}

function cleanPhone(phone: string): string {
  const clean = phone.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(clean)) throw new HttpError(400, 'phone must be a 10-digit number.');
  return clean;
}

// Trimmed text with a length range, e.g. a subject or a message.
function textField(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${name} is a required text field.`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) {
    throw new HttpError(400, `${name} must be ${min}-${max} characters.`);
  }
  return clean;
}

export function parseOrderStatusInput(body: Record<string, unknown>): OrderStatusInput {
  const { orderId, phone } = body;
  if (typeof orderId !== 'string' || typeof phone !== 'string') {
    throw new HttpError(400, 'orderId and phone are required text fields.');
  }
  return { orderId: cleanOrderId(orderId), phone: cleanPhone(phone) };
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_TEXT = 1000; // customer messages
export const MAX_MODEL_TEXT = 4000; // earlier AI replies sent back as history (they can be long)

// The browser sends the whole conversation each time (the server keeps no state).
export function parseChatInput(body: Record<string, unknown>): ChatMessage[] {
  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_CHAT_MESSAGES) {
    throw new HttpError(400, `messages must be a list of 1-${MAX_CHAT_MESSAGES} items.`);
  }
  const parsed = messages.map((m: unknown, i): ChatMessage => {
    if (typeof m !== 'object' || m === null) throw new HttpError(400, `messages[${i}] must be an object.`);
    const { role, text } = m as Record<string, unknown>;
    if (role !== 'user' && role !== 'model') {
      throw new HttpError(400, `messages[${i}].role must be "user" or "model".`);
    }
    const maxText = role === 'user' ? MAX_CHAT_TEXT : MAX_MODEL_TEXT;
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > maxText) {
      throw new HttpError(400, `messages[${i}].text must be 1-${maxText} characters.`);
    }
    return { role, text: text.trim() };
  });
  if (parsed[0].role !== 'user') throw new HttpError(400, 'The conversation must start with a user message.');
  if (parsed[parsed.length - 1].role !== 'user') {
    throw new HttpError(400, 'The last message must be from the user.');
  }
  return parsed;
}

export interface QueryInput {
  phone: string;
  orderId?: string;
  type: 'complaint' | 'query';
  subject: string;
  message: string;
}

export function parseQueryInput(body: Record<string, unknown>): QueryInput {
  const { phone, orderId, type } = body;
  if (typeof phone !== 'string') throw new HttpError(400, 'phone is a required text field.');
  if (type !== 'complaint' && type !== 'query') {
    throw new HttpError(400, 'type must be "complaint" or "query".');
  }
  const result: QueryInput = {
    phone: cleanPhone(phone),
    type,
    subject: textField(body.subject, 'subject', 3, 100),
    message: textField(body.message, 'message', 10, 1000),
  };
  if (orderId !== undefined) {
    if (typeof orderId !== 'string') throw new HttpError(400, 'orderId must be text.');
    result.orderId = cleanOrderId(orderId);
  }
  return result;
}

export interface HandoffInput {
  phone: string;
  orderId?: string;
  reason: string;
  conversationSummary: string;
}

export function parseHandoffInput(body: Record<string, unknown>): HandoffInput {
  const { phone, orderId } = body;
  if (typeof phone !== 'string') throw new HttpError(400, 'phone is a required text field.');
  const result: HandoffInput = {
    phone: cleanPhone(phone),
    reason: textField(body.reason, 'reason', 5, 300),
    conversationSummary: textField(body.conversationSummary, 'conversationSummary', 10, 2000),
  };
  if (orderId !== undefined) {
    if (typeof orderId !== 'string') throw new HttpError(400, 'orderId must be text.');
    result.orderId = cleanOrderId(orderId);
  }
  return result;
}

export interface RefundRequestInput extends OrderStatusInput {
  reason: string;
  amount?: number;
}

export function parseRefundRequestInput(body: Record<string, unknown>): RefundRequestInput {
  const base = parseOrderStatusInput(body); // validates orderId + phone
  const { reason, amount } = body;
  if (typeof reason !== 'string') throw new HttpError(400, 'reason is a required text field.');
  const cleanReason = reason.trim();
  if (cleanReason.length < 5 || cleanReason.length > 300) {
    throw new HttpError(400, 'reason must be 5-300 characters.');
  }
  if (amount !== undefined) {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      throw new HttpError(400, 'amount must be a positive number (up to 100000).');
    }
    return { ...base, reason: cleanReason, amount: Math.round(amount * 100) / 100 };
  }
  return { ...base, reason: cleanReason };
}

export function parseProductSearchInput(params: URLSearchParams): ProductSearchInput {
  const qRaw = params.get('q')?.trim() ?? '';
  const categoryRaw = params.get('category')?.trim().toLowerCase() ?? '';
  if (!qRaw && !categoryRaw) {
    throw new HttpError(400, 'Provide a search term (q) or a category.');
  }
  if (qRaw.length > 50) throw new HttpError(400, 'q must be 50 characters or fewer.');
  if (categoryRaw && !/^[a-z]{2,20}$/.test(categoryRaw)) {
    throw new HttpError(400, 'category must be 2-20 letters.');
  }

  let limit = 10;
  const limitRaw = params.get('limit');
  if (limitRaw !== null) {
    if (!/^\d{1,2}$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 20) {
      throw new HttpError(400, 'limit must be a whole number from 1 to 20.');
    }
    limit = Number(limitRaw);
  }

  const inStockRaw = params.get('inStockOnly');
  if (inStockRaw !== null && inStockRaw !== 'true' && inStockRaw !== 'false') {
    throw new HttpError(400, 'inStockOnly must be "true" or "false".');
  }

  return {
    q: qRaw || undefined,
    category: categoryRaw || undefined,
    inStockOnly: inStockRaw === 'true',
    limit,
  };
}

// Makes user text safe to use inside a MongoDB regular expression, so that
// characters like ".*" are treated as plain text and not as a pattern.
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
