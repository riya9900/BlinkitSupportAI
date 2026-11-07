// The real connection to Google Gemini. The API key is read from the
// environment on the server and never sent to the browser.
import { GoogleGenAI, type Content } from '@google/genai';
import type { GenerateFn, ModelTurn } from './agent.js';
import { toolDeclarations } from './agentTools.js';
import { readEnv } from './env.js';
import { HttpError } from './http.js';
import { logError } from './log.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

// Any Gemini model that supports function calling works. Override with GEMINI_MODEL.
export const DEFAULT_MODEL = 'gemini-2.5-flash';

const MAX_ATTEMPTS = 3; // for temporary Google-side errors
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

let client: GoogleGenAI | undefined;
let lastRequestAt = 0;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = readEnv('GEMINI_API_KEY');
    if (!apiKey) throw new Error('Missing environment variable GEMINI_API_KEY. See .env.example.');
    // Stop waiting on Gemini before Vercel's 30s function limit, so a slow call becomes a
    // logged error instead of a silent 504.
    const timeout = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? '', 10);
    client = new GoogleGenAI({ apiKey, httpOptions: { timeout: Number.isInteger(timeout) && timeout > 0 ? timeout : 15000 } });
  }
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Optional: GEMINI_MIN_INTERVAL_MS spaces out requests (per server instance).
// Handy on the free tier (5 requests/minute => 13000). Unset = no spacing.
async function respectMinInterval(): Promise<void> {
  const minInterval = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 0);
  if (minInterval > 0) {
    const wait = lastRequestAt + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
  }
  lastRequestAt = Date.now();
}

// Pulls the HTTP status out of an SDK error (the SDK's ApiError has `.status`).
export function geminiErrorStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

// Plain-English hint for the server log: which setting to check for each kind of failure.
export function geminiHint(status: number | undefined): string {
  if (status === undefined) return 'No HTTP status: network problem or timeout while calling Gemini.';
  if (status === 400) return 'Gemini rejected the request. Most common cause: GEMINI_API_KEY is invalid (extra spaces or quotes?) or GEMINI_MODEL is wrong.';
  if (status === 401 || status === 403) return 'Gemini rejected the API key. Check GEMINI_API_KEY is a valid, unrestricted key from aistudio.google.com.';
  if (status === 404) return 'Gemini model not found. Check GEMINI_MODEL.';
  if (status === 429) return 'Gemini quota or rate limit reached.';
  return 'Gemini-side problem (5xx).';
}

// What we tell OUR client when Gemini fails for good (details stay in the logs).
export function httpErrorForGemini(status: number | undefined): HttpError {
  if (status === 429) {
    return new HttpError(429, 'The assistant is getting a lot of requests right now. Please wait a few seconds and try again.', 'AI_RATE_LIMITED');
  }
  return new HttpError(503, 'The AI assistant is temporarily unavailable. Please try again in a moment.', 'AI_UNAVAILABLE');
}

export const generateWithGemini: GenerateFn = async (contents: Content[]): Promise<ModelTurn> => {
  // Outside the try: a missing key is OUR misconfiguration (500, logged), not a
  // temporary Gemini outage (503).
  const ai = getClient();

  let response;
  for (let attempt = 1; ; attempt++) {
    await respectMinInterval();
    try {
      response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: toolDeclarations }],
          temperature: 0.2, // low = more consistent, less "creative"
          maxOutputTokens: 1024,
        },
      });
      break;
    } catch (err) {
      const status = geminiErrorStatus(err);
      logError('gemini.request_failed', err, {
        attempt,
        status,
        model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
        hint: geminiHint(status),
      });
      // Retry only temporary server-side problems, never rate limits (retrying
      // a 429 immediately just fails again and wastes the serverless time budget).
      if (status !== undefined && RETRYABLE_STATUSES.has(status) && attempt < MAX_ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
      throw httpErrorForGemini(status);
    }
  }

  const content = response.candidates?.[0]?.content;
  if (!content) {
    // e.g. the reply was blocked by safety filters.
    throw new HttpError(502, 'The AI assistant could not produce a reply. Please rephrase and try again.');
  }

  const parts = content.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  const functionCalls = parts
    .filter((p) => p.functionCall?.name)
    .map((p) => ({
      id: p.functionCall?.id,
      name: p.functionCall?.name as string,
      args: (p.functionCall?.args ?? {}) as Record<string, unknown>,
    }));

  return { text, functionCalls, content };
};
