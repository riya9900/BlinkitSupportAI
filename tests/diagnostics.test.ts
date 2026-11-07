// Tests for the production-failure diagnostics: env reading, safe logging, MongoDB
// failure handling and /api/health. No real database or Gemini key needed. Run: npm test
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { GET as health, POST as healthPost } from '../api/health.js';
import { DbUnavailableError, classifyDbError, closeDb, getDb } from '../lib/db.js';
import { readEnv } from '../lib/env.js';
import { geminiHint } from '../lib/gemini.js';
import { redact } from '../lib/log.js';

// Fake secrets, assembled from pieces so secret scanners do not mistake them for real ones.
const FAKE_PASSWORD = 'pa55' + 'word-for-tests';
const FAKE_URI = 'mongodb' + '://tester:' + FAKE_PASSWORD + '@127.0.0.1:1/blinkit?retryWrites=true';
const FAKE_KEY = 'fake-gemini-' + 'key-for-tests';
const FAKE_SALT = 'fake-salt-' + 'for-tests-only';

const NAMES = ['MONGODB_URI', 'MONGODB_DB', 'MONGODB_TIMEOUT_MS', 'GEMINI_API_KEY', 'RATE_LIMIT_SALT'] as const;
const saved: Record<string, string | undefined> = {};
const realConsoleError = console.error;
let logged: string[] = [];

beforeEach(() => {
  for (const n of NAMES) saved[n] = process.env[n];
  logged = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
});
afterEach(async () => {
  console.error = realConsoleError;
  await closeDb();
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

const useUnreachableDb = () => {
  process.env.MONGODB_URI = FAKE_URI;
  process.env.MONGODB_TIMEOUT_MS = '300'; // nothing listens on port 1, fail quickly
  process.env.RATE_LIMIT_SALT = FAKE_SALT;
  process.env.GEMINI_API_KEY = FAKE_KEY;
};

test('readEnv: trims spaces and one pair of wrapping quotes; empty means not set', () => {
  process.env.MONGODB_DB = '  "my_db"\n';
  assert.equal(readEnv('MONGODB_DB'), 'my_db');
  process.env.MONGODB_DB = "'x'";
  assert.equal(readEnv('MONGODB_DB'), 'x');
  process.env.MONGODB_DB = '   ';
  assert.equal(readEnv('MONGODB_DB'), undefined);
  delete process.env.MONGODB_DB;
  assert.equal(readEnv('MONGODB_DB'), undefined);
});

test('redact: removes secret values and anything shaped like a DB URI or Google key', () => {
  process.env.MONGODB_URI = FAKE_URI;
  process.env.GEMINI_API_KEY = FAKE_KEY;
  const text = `failed for ${FAKE_URI} with key ${FAKE_KEY} and ${'mongodb+srv' + '://u:p@h.example.net/x'} and ${'AIza' + 'A'.repeat(30)}`;
  const out = redact(text);
  for (const secret of [FAKE_PASSWORD, FAKE_KEY, '127.0.0.1:1', 'AIzaAAAA', 'u:p@']) {
    assert.ok(!out.includes(secret), `leaked ${secret}: ${out}`);
  }
});

test('classifyDbError: tells apart the common Atlas setup mistakes', () => {
  assert.equal(classifyDbError({ name: 'MongoParseError', message: 'Invalid scheme' }), 'uri-format');
  assert.equal(classifyDbError({ name: 'MongoServerError', code: 18, message: 'bad auth' }), 'auth');
  assert.equal(classifyDbError({ name: 'MongoServerSelectionError', message: 'Server selection timed out' }), 'network');
  // Server selection hides a login failure inside the per-server details.
  const hidden = {
    name: 'MongoServerSelectionError',
    message: 'Server selection timed out',
    reason: { servers: new Map([['a', { error: { message: 'bad auth : authentication failed' } }]]) },
  };
  assert.equal(classifyDbError(hidden), 'auth');
  assert.equal(classifyDbError(new Error('something else')), 'unknown');
});

test('getDb: an unreachable database fails fast with a clean 503 and logs a safe, useful line', async () => {
  useUnreachableDb();
  const started = Date.now();
  await assert.rejects(getDb(), (err: unknown) => {
    assert.ok(err instanceof DbUnavailableError);
    assert.equal(err.status, 503);
    assert.equal(err.code, 'DB_UNAVAILABLE');
    assert.equal(err.kind, 'network');
    assert.ok(!/mongodb|127\.0\.0\.1|pa55/i.test(err.message));
    return true;
  });
  assert.ok(Date.now() - started < 5000, 'must give up quickly instead of hanging');

  const log = logged.join('\n');
  assert.match(log, /db\.connect_failed/);
  assert.match(log, /Network Access/); // the hint tells the owner what to fix
  assert.ok(!log.includes(FAKE_PASSWORD), 'password leaked into logs');
  assert.ok(!log.includes(FAKE_URI), 'connection string leaked into logs');
});

test('getDb: a failed attempt is not cached, so the next request really retries', async () => {
  useUnreachableDb();
  await assert.rejects(getDb(), DbUnavailableError);
  const firstRun = logged.filter((l) => l.includes('db.connect_failed')).length;
  await assert.rejects(getDb(), DbUnavailableError);
  const secondRun = logged.filter((l) => l.includes('db.connect_failed')).length;
  assert.equal(firstRun, 1);
  assert.equal(secondRun, 2); // a second real attempt happened (and was logged)
});

test('getDb: a missing MONGODB_URI is reported as a setup mistake', async () => {
  delete process.env.MONGODB_URI;
  await assert.rejects(getDb(), /Missing environment variable MONGODB_URI/);
});

test('/api/health: reports missing settings as yes/no only, with status 503', async () => {
  for (const n of ['MONGODB_URI', 'GEMINI_API_KEY', 'RATE_LIMIT_SALT']) delete process.env[n];
  const res = await health(new Request('http://test/api/health'));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.deepEqual(body, {
    ok: false,
    env: { MONGODB_URI: false, RATE_LIMIT_SALT: false, GEMINI_API_KEY: false },
    database: 'skipped',
  });
});

test('/api/health: a database that cannot be reached is reported by category, never by detail', async () => {
  useUnreachableDb();
  const res = await health(new Request('http://test/api/health', { headers: { 'x-real-ip': '203.0.113.9' } }));
  assert.equal(res.status, 503);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.ok, false);
  assert.deepEqual(body.env, { MONGODB_URI: true, RATE_LIMIT_SALT: true, GEMINI_API_KEY: true });
  assert.equal(body.database, 'failed');
  assert.equal(body.databaseProblem, 'network');
  for (const secret of [FAKE_PASSWORD, FAKE_KEY, FAKE_SALT, '127.0.0.1']) {
    assert.ok(!text.includes(secret), `health response leaked ${secret}`);
  }
});

test('/api/health: only GET is allowed', async () => {
  assert.equal((await healthPost(new Request('http://test/api/health', { method: 'POST' }))).status, 405);
});

test('geminiHint: points at the setting to check', () => {
  assert.match(geminiHint(400), /GEMINI_API_KEY/);
  assert.match(geminiHint(403), /GEMINI_API_KEY/);
  assert.match(geminiHint(404), /GEMINI_MODEL/);
  assert.match(geminiHint(undefined), /timeout|network/i);
});
