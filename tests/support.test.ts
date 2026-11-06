// Unit tests for the complaint/query and handoff input validation. No database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError } from '../lib/http.js';
import { parseHandoffInput, parseQueryInput } from '../lib/validation.js';

const rejects400 = (fn: () => unknown) =>
  assert.throws(fn, (e) => e instanceof HttpError && e.status === 400);

const goodQuery = {
  phone: '9000000003',
  type: 'complaint',
  subject: 'Late delivery',
  message: 'My order arrived an hour late.',
};

test('query input: accepts a good complaint and normalises values', () => {
  const r = parseQueryInput({ ...goodQuery, phone: '90000-00003', orderId: ' ord1006 ', subject: '  Late delivery ' });
  assert.deepEqual(r, { ...goodQuery, orderId: 'ORD1006' });
});

test('query input: orderId is optional', () => {
  assert.equal(parseQueryInput(goodQuery).orderId, undefined);
});

test('query input: rejects bad values', () => {
  rejects400(() => parseQueryInput({}));
  rejects400(() => parseQueryInput({ ...goodQuery, type: 'praise' }));
  rejects400(() => parseQueryInput({ ...goodQuery, phone: '123' }));
  rejects400(() => parseQueryInput({ ...goodQuery, subject: 'ab' }));
  rejects400(() => parseQueryInput({ ...goodQuery, subject: 'x'.repeat(101) }));
  rejects400(() => parseQueryInput({ ...goodQuery, message: 'too short' }));
  rejects400(() => parseQueryInput({ ...goodQuery, message: 'x'.repeat(1001) }));
  rejects400(() => parseQueryInput({ ...goodQuery, orderId: 'nope' }));
  rejects400(() => parseQueryInput({ ...goodQuery, orderId: 5 }));
  rejects400(() => parseQueryInput({ ...goodQuery, message: { $gt: '' } }));
  rejects400(() => parseQueryInput({ ...goodQuery, phone: { $ne: null } }));
});

const goodHandoff = {
  phone: '9000000003',
  reason: 'Customer is upset about repeated delays',
  conversationSummary: 'Asked about ORD1006 three times and wants a person.',
};

test('handoff input: accepts good values with and without orderId', () => {
  assert.deepEqual(parseHandoffInput(goodHandoff), goodHandoff);
  assert.equal(parseHandoffInput({ ...goodHandoff, orderId: 'ord1006' }).orderId, 'ORD1006');
});

test('handoff input: rejects bad values', () => {
  rejects400(() => parseHandoffInput({}));
  rejects400(() => parseHandoffInput({ ...goodHandoff, reason: 'no' }));
  rejects400(() => parseHandoffInput({ ...goodHandoff, reason: 'x'.repeat(301) }));
  rejects400(() => parseHandoffInput({ ...goodHandoff, conversationSummary: 'short' }));
  rejects400(() => parseHandoffInput({ ...goodHandoff, conversationSummary: 'x'.repeat(2001) }));
  rejects400(() => parseHandoffInput({ ...goodHandoff, phone: 9000000003 }));
  rejects400(() => parseHandoffInput({ ...goodHandoff, orderId: 'bad' }));
});
