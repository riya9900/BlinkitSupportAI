// GET /api/health
// A quick self-check for the deployed site. Open https://<your-site>/api/health in a browser.
// It answers only yes/no and a short failure category. It NEVER returns a secret, a host
// name or an error message. It is rate limited like the other lookup endpoints.
// (It does not call Gemini, so it costs no AI quota.)
import { DbUnavailableError, getDb } from '../lib/db.js';
import { readEnv } from '../lib/env.js';
import { HttpError, handle, json, rejectOtherMethods, requireMethod } from '../lib/http.js';
import { limitRequest } from '../lib/rateLimit.js';

export const GET = handle(async (request) => {
  requireMethod(request, 'GET');

  // 1. Are the settings present (after trimming spaces/quotes)? Names only, never values.
  const env = {
    MONGODB_URI: Boolean(readEnv('MONGODB_URI')),
    RATE_LIMIT_SALT: Boolean(readEnv('RATE_LIMIT_SALT')),
    GEMINI_API_KEY: Boolean(readEnv('GEMINI_API_KEY')),
  };

  // 2. Can we really use the database? limitRequest writes a rate-limit counter, which
  //    proves connect + login + write access; the ping proves the server answers.
  let database: 'ok' | 'failed' | 'skipped' = 'skipped';
  let databaseProblem: string | undefined;
  if (env.MONGODB_URI && env.RATE_LIMIT_SALT) {
    try {
      await limitRequest(request, 'lookup');
      await (await getDb()).command({ ping: 1 });
      database = 'ok';
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) throw err; // visitor is calling too often
      database = 'failed';
      databaseProblem = err instanceof DbUnavailableError ? err.kind : 'unknown'; // details are in the server log
    }
  }

  const ok = env.MONGODB_URI && env.RATE_LIMIT_SALT && env.GEMINI_API_KEY && database === 'ok';
  return json({ ok, env, database, ...(databaseProblem ? { databaseProblem } : {}) }, ok ? 200 : 503);
});

const wrongMethod = rejectOtherMethods('GET');
export const POST = wrongMethod;
export const PUT = wrongMethod;
export const DELETE = wrongMethod;
