// Server-side logging that is safe to read in the Vercel logs: every message is
// scrubbed so a secret (database password, API key, salt) can never be printed.
import { readEnv } from './env.js';

const SECRET_ENV_NAMES = ['MONGODB_URI', 'GEMINI_API_KEY', 'RATE_LIMIT_SALT'] as const;

// Replaces secret values (and anything shaped like a DB URI or Google key) with a label.
export function redact(text: string): string {
  let out = text;
  for (const name of SECRET_ENV_NAMES) {
    for (const value of [process.env[name], readEnv(name)]) {
      if (value && value.length >= 6) out = out.split(value).join(`[${name}]`);
    }
  }
  return out
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, '[mongodb-uri]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[google-api-key]');
}

// Hints for MongoDB server error codes that mean "the setup is wrong", not "the code is wrong".
const MONGO_CODE_HINTS: Record<string, string> = {
  '13': 'MongoDB user is not allowed to do this. In Atlas > Database Access give the user "Read and write to any database".',
  '18': 'MongoDB rejected the login. Check the user name and password in MONGODB_URI (URL-encode special characters in the password).',
};

// A small, safe description of an error: name, codes, and a clipped, redacted message.
export function describeError(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) {
    return { value: redact(String(err)).slice(0, 300) };
  }
  const e = err as { name?: unknown; message?: unknown; code?: unknown; codeName?: unknown; status?: unknown };
  const info: Record<string, unknown> = {
    name: String(e.name ?? 'Error'),
    message: redact(String(e.message ?? '')).slice(0, 300),
  };
  if (e.code !== undefined) info.code = e.code;
  if (e.codeName !== undefined) info.codeName = e.codeName;
  if (e.status !== undefined) info.status = e.status;
  const hint = MONGO_CODE_HINTS[String(e.code)];
  if (hint && typeof e.codeName === 'string') info.hint = hint;
  return info;
}

// One JSON line per event, easy to search in Vercel > Logs, e.g. search "db.connect_failed".
export function logError(event: string, err: unknown, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ...extra, ...describeError(err) });
  console.error(`[${event}] ${redact(line)}`);
}
