// Pure chat logic: no React, no browser APIs, so it can be unit tested in Node.
// The limits below mirror the server's (lib/validation.ts); the server is the
// real enforcer, the browser just avoids sending requests it knows will fail.

export const MAX_USER_TEXT = 1000; // characters in one customer message
export const MAX_MODEL_TEXT = 4000; // characters of an earlier AI reply sent back as history
export const MAX_HISTORY = 20; // messages sent per request

export interface ToolCallInfo {
  name: string;
  ok: boolean;
}

// What the screen shows.
export interface UiMessage {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  tools?: ToolCallInfo[]; // which backend tools the AI used for this reply
  retryable?: boolean; // errors only: is "Try again" worth offering?
  createdAt?: Date; // timestamp for realistic messaging
}

// What the server expects.
export interface ApiMessage {
  role: 'user' | 'model';
  text: string;
}

// Turns the on-screen messages into the history the server wants:
//  - error bubbles are not part of the conversation
//  - consecutive messages from the same side are merged (the AI API wants turns to alternate)
//  - over-long text is clipped, only the newest MAX_HISTORY messages are kept
//  - it must start and end with a customer message, otherwise nothing is sent
export function buildHistory(messages: UiMessage[]): ApiMessage[] {
  const merged: ApiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'error') continue;
    const role = m.role === 'user' ? 'user' : 'model';
    const text = m.text.trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.text += `\n\n${text}`;
    else merged.push({ role, text });
  }

  const clipped = merged.map((m) =>
    m.role === 'user'
      ? { ...m, text: m.text.slice(-MAX_USER_TEXT) } // keep the newest part
      : { ...m, text: m.text.slice(0, MAX_MODEL_TEXT) },
  );

  let recent = clipped.slice(-MAX_HISTORY);
  while (recent.length > 0 && recent[0].role !== 'user') recent = recent.slice(1);
  if (recent.length === 0 || recent[recent.length - 1].role !== 'user') return [];
  return recent;
}

export interface FriendlyError {
  text: string;
  retryable: boolean;
}

// Turns an HTTP status into something a customer can understand. Server error
// text is shown only for 400s (those are our own validation messages).
export function friendlyError(status: number | null, serverMessage?: string): FriendlyError {
  if (status === null) {
    return { text: "I can't reach the server. Please check your connection and try again.", retryable: true };
  }
  if (status === 429) {
    return { text: 'The assistant is busy right now. Please wait a few seconds and try again.', retryable: true };
  }
  if (status === 400) {
    return { text: serverMessage || 'That message could not be sent. Please rephrase it.', retryable: false };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { text: 'The assistant is temporarily unavailable. Please try again in a moment.', retryable: true };
  }
  return { text: 'Something went wrong on our side. Please try again.', retryable: true };
}

// Friendly names for the backend tools, shown as small badges under replies.
const TOOL_LABELS: Record<string, string> = {
  get_order_status: 'Checked order status',
  search_products: 'Searched products',
  check_refund_eligibility: 'Checked refund eligibility',
  request_refund: 'Submitted refund request',
  get_refund_status: 'Checked refund status',
  create_query: 'Logged your query',
  escalate_to_human: 'Connected with human agent',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? 'Used a support tool';
}

// Welcome screen suggestion cards
export interface SuggestionCard {
  id: string;
  title: string;
  subtitle: string;
  prompt: string;
  icon: 'track' | 'refund' | 'product' | 'support';
  tag?: string;
}

export const SUGGESTION_CARDS: SuggestionCard[] = [
  {
    id: 'track',
    title: 'Track My Order',
    subtitle: 'Check live status, items and delivery ETA',
    prompt: 'Where is my order ORD1002? My phone number is 9000000001.',
    icon: 'track',
    tag: 'Instant',
  },
  {
    id: 'refund',
    title: 'Request a Refund',
    subtitle: 'Hassle-free resolutions for damaged items',
    prompt: 'I want a refund for ORD1001. My phone is 9000000001. The milk packet was leaking.',
    icon: 'refund',
    tag: 'Fast Approval',
  },
  {
    id: 'product',
    title: 'Find Products',
    subtitle: 'Browse catalog, prices & stock availability',
    prompt: 'Do you have milk? How much is it?',
    icon: 'product',
  },
  {
    id: 'support',
    title: 'Talk to Support',
    subtitle: 'Escalate to a human customer care specialist',
    prompt: 'I want to talk to a real person. My phone is 9000000003.',
    icon: 'support',
    tag: 'Live Agent',
  },
];

export const SAMPLE_PROMPTS: { label: string; text: string }[] = SUGGESTION_CARDS.map((c) => ({
  label: c.title,
  text: c.prompt,
}));
