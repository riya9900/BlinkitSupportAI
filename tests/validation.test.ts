// Unit tests: no database needed. Run: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpError } from '../lib/http.js';
import {
  escapeRegex,
  parseOrderStatusInput,
  parseProductSearchInput,
} from '../lib/validation.js';

const rejects400 = (fn: () => unknown) =>
  assert.throws(fn, (e) => e instanceof HttpError && e.status === 400);

test('order input: accepts and normalises good values', () => {
  assert.deepEqual(parseOrderStatusInput({ orderId: ' ord1001 ', phone: '90000-00001' }), {
    orderId: 'ORD1001',
    phone: '9000000001',
  });
});

test('order input: rejects bad or missing values', () => {
  rejects400(() => parseOrderStatusInput({}));
  rejects400(() => parseOrderStatusInput({ orderId: 5, phone: '9000000001' }));
  rejects400(() => parseOrderStatusInput({ orderId: 'ORD1001', phone: '12345' }));
  rejects400(() => parseOrderStatusInput({ orderId: 'XYZ1', phone: '9000000001' }));
  rejects400(() => parseOrderStatusInput({ orderId: { $ne: '' }, phone: '9000000001' }));
});

test('product input: defaults and parsing', () => {
  const r = parseProductSearchInput(new URLSearchParams('q=Milk'));
  assert.deepEqual(r, { q: 'Milk', category: undefined, inStockOnly: false, limit: 10 });
  const r2 = parseProductSearchInput(new URLSearchParams('category=DAIRY&limit=3&inStockOnly=true'));
  assert.deepEqual(r2, { q: undefined, category: 'dairy', inStockOnly: true, limit: 3 });
});

test('product input: rejects bad values', () => {
  rejects400(() => parseProductSearchInput(new URLSearchParams('')));
  rejects400(() => parseProductSearchInput(new URLSearchParams('q=' + 'a'.repeat(51))));
  rejects400(() => parseProductSearchInput(new URLSearchParams('q=milk&limit=0')));
  rejects400(() => parseProductSearchInput(new URLSearchParams('q=milk&limit=21')));
  rejects400(() => parseProductSearchInput(new URLSearchParams('q=milk&limit=abc')));
  rejects400(() => parseProductSearchInput(new URLSearchParams('category=da1ry')));
  rejects400(() => parseProductSearchInput(new URLSearchParams('q=milk&inStockOnly=yes')));
});

test('escapeRegex neutralises regex characters', () => {
  assert.equal(escapeRegex('.*'), '\\.\\*');
  assert.equal(new RegExp(escapeRegex('a+b(c)')).test('a+b(c)'), true);
  assert.equal(new RegExp(escapeRegex('.*')).test('milk'), false);
});
