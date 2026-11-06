// Unit tests for the frontend's pure chat logic (src/chatLogic.ts). No browser,
// no database, no Gemini. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_HISTORY,
  MAX_MODEL_TEXT,
  MAX_USER_TEXT,
  SAMPLE_PROMPTS,
  buildHistory,
  friendlyError,
  toolLabel,
  type UiMessage,
} from '../src/chatLogic.js';
import { parseChatInput } from '../lib/validation.js';

let id = 0;
const user = (text: string): UiMessage => ({ id: ++id, role: 'user', text });
const bot = (text: string): UiMessage => ({ id: ++id, role: 'assistant', text });
const err = (): UiMessage => ({ id: ++id, role: 'error', text: 'oops', retryable: true });

test('history: maps assistant to model and keeps order', () => {
  assert.deepEqual(buildHistory([user('hi'), bot('hello'), user('status?')]), [
    { role: 'user', text: 'hi' },
    { role: 'model', text: 'hello' },
    { role: 'user', text: 'status?' },
  ]);
});

test('history: error bubbles are not part of the conversation', () => {
  assert.deepEqual(buildHistory([user('hi'), err()]), [{ role: 'user', text: 'hi' }]);
});

test('history: after an error, a new message is merged into the previous user turn', () => {
  const h = buildHistory([user('first try'), err(), user('second try')]);
  assert.equal(h.length, 1);
  assert.equal(h[0].role, 'user');
  assert.equal(h[0].text, 'first try\n\nsecond try');
});

test('history: must end with a customer message, otherwise nothing is sent', () => {
  assert.deepEqual(buildHistory([]), []);
  assert.deepEqual(buildHistory([user('hi'), bot('hello')]), []);
});

test('history: never starts with an AI message', () => {
  const messages: UiMessage[] = [];
  for (let i = 0; i < 15; i++) messages.push(user(`q${i}`), bot(`a${i}`));
  messages.push(user('latest'));
  const h = buildHistory(messages);
  assert.ok(h.length <= MAX_HISTORY);
  assert.equal(h[0].role, 'user');
  assert.deepEqual(h[h.length - 1], { role: 'user', text: 'latest' });
});

test('history: long text is clipped to what the server accepts', () => {
  const h = buildHistory([user('x'.repeat(5000)), bot('y'.repeat(9000)), user('z'.repeat(2500))]);
  assert.ok(h[0].text.length <= MAX_USER_TEXT);
  assert.ok(h[1].text.length <= MAX_MODEL_TEXT);
  assert.ok(h[2].text.length <= MAX_USER_TEXT);
  assert.doesNotThrow(() => parseChatInput({ messages: h }));
});

test('history: whatever the screen holds, the result passes the server validation', () => {
  const messages: UiMessage[] = [];
  for (let i = 0; i < 40; i++) {
    messages.push(user(`question ${i} ` + 'q'.repeat(i * 40)));
    if (i % 7 === 3) messages.push(err());
    else messages.push(bot(`answer ${i} ` + 'a'.repeat(i * 150)));
  }
  messages.push(user('final question'));
  const h = buildHistory(messages);
  assert.ok(h.length > 0);
  assert.doesNotThrow(() => parseChatInput({ messages: h }));
});

test('friendlyError: sensible text per failure, server text only for 400', () => {
  assert.equal(friendlyError(429).retryable, true);
  assert.match(friendlyError(429).text, /busy/i);
  assert.match(friendlyError(null).text, /connection/i);
  assert.equal(friendlyError(503).retryable, true);
  assert.deepEqual(friendlyError(400, 'reason must be 5-300 characters.'), {
    text: 'reason must be 5-300 characters.',
    retryable: false,
  });
  // Server text for other statuses is NOT shown (it could contain internals).
  assert.ok(!friendlyError(500, 'secret internal detail').text.includes('secret'));
  assert.equal(friendlyError(500).retryable, true);
});

test('toolLabel: friendly names, safe fallback for unknown tools', () => {
  assert.equal(toolLabel('get_order_status'), 'Checked order status');
  assert.equal(toolLabel('something_new'), 'Used a support tool');
});

test('sample prompts: each is valid for the server and uses real sample data', () => {
  assert.ok(SAMPLE_PROMPTS.length > 0);
  for (const p of SAMPLE_PROMPTS) {
    assert.ok(p.text.length <= MAX_USER_TEXT, p.label);
    assert.doesNotThrow(() => parseChatInput({ messages: [{ role: 'user', text: p.text }] }), p.label);
    for (const phone of p.text.match(/\b9\d{9}\b/g) ?? []) {
      assert.ok(['9000000001', '9000000002', '9000000003'].includes(phone), `${p.label}: ${phone}`);
    }
    for (const order of p.text.match(/\bORD\d+\b/g) ?? []) {
      assert.ok(/^ORD100[1-6]$/.test(order), `${p.label}: ${order}`);
    }
  }
});
