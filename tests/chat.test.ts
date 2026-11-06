// /api/chat input handling. Needs no Gemini key and no database. Run: npm test
import './noRateLimit.js'; // these tests are not about rate limiting
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../api/chat.js';
import { geminiErrorStatus, httpErrorForGemini } from '../lib/gemini.js';

const post = (body: unknown) =>
  POST(new Request('http://test/api/chat', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

test('chat endpoint: bad input is rejected with 400 before any AI call', async () => {
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ messages: [] })).status, 400);
  assert.equal((await post({ messages: [{ role: 'model', text: 'hi' }] })).status, 400);
  assert.equal((await post({ messages: [{ role: 'user', text: 'x'.repeat(1001) }] })).status, 400);
});

test('gemini errors: 429 is reported as rate-limited, everything else as unavailable', () => {
  assert.equal(httpErrorForGemini(429).status, 429);
  assert.equal(httpErrorForGemini(429).code, 'AI_RATE_LIMITED');
  for (const s of [500, 503, 400, 401, undefined]) {
    assert.equal(httpErrorForGemini(s).status, 503);
  }
  assert.equal(geminiErrorStatus({ status: 429 }), 429);
  assert.equal(geminiErrorStatus(new Error('x')), undefined);
  assert.equal(geminiErrorStatus(null), undefined);
  // Raw provider details must never be copied into the message shown to users.
  assert.ok(!/quota|billing|google/i.test(httpErrorForGemini(429).message));
});

test('chat endpoint: wrong method is 405', async () => {
  assert.equal((await GET(new Request('http://test/api/chat'))).status, 405);
});

test('chat endpoint: a missing API key gives a generic 500 that does not leak details', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const originalError = console.error;
  console.error = () => {}; // the real cause is logged server-side
  try {
    const res = await post({ messages: [{ role: 'user', text: 'hello' }] });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!/GEMINI|env|key/i.test(text), text);
  } finally {
    console.error = originalError;
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  }
});
