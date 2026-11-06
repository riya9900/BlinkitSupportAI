// Integration tests: call the real handlers against the seeded MongoDB.
// Needs .env and seeded data. Run: npm run test:live
import './noRateLimit.js'; // these tests are not about rate limiting
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { POST as orderStatus, GET as orderStatusGet } from '../api/order-status.js';
import { GET as productsSearch } from '../api/products-search.js';
import { closeDb } from '../lib/db.js';

after(closeDb);

// Shape of the JSON we read back in these tests.
interface Body {
  order: { status: string; statusLabel: string; total: number; items: unknown[] };
  count: number;
  products: { _id: string }[];
}
const read = async (res: Response) => (await res.json()) as Body;

const post = (body: unknown) =>
  orderStatus(
    new Request('http://test/api/order-status', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const search = (qs: string) =>
  productsSearch(new Request(`http://test/api/products-search?${qs}`));

test('order status: correct id + phone returns the order', async () => {
  const res = await post({ orderId: 'ORD1001', phone: '9000000001' });
  assert.equal(res.status, 200);
  const { order } = await read(res);
  assert.equal(order.status, 'delivered');
  assert.equal(order.total, 111);
  assert.equal(order.items.length, 2);
});

test('order status: out-for-delivery order has a readable label', async () => {
  const { order } = await read(await post({ orderId: 'ORD1002', phone: '9000000001' }));
  assert.equal(order.statusLabel, 'Out for delivery');
});

test('order status: wrong phone and unknown order give the same 404', async () => {
  const wrongPhone = await post({ orderId: 'ORD1001', phone: '9000000002' });
  const unknown = await post({ orderId: 'ORD9999', phone: '9000000001' });
  assert.equal(wrongPhone.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await wrongPhone.json(), await unknown.json());
});

test('order status: bad input is 400, bad JSON is 400, GET is 405', async () => {
  assert.equal((await post({ orderId: 'nope', phone: '1' })).status, 400);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post({ orderId: { $ne: null }, phone: '9000000001' })).status, 400);
  const get = await orderStatusGet(new Request('http://test/api/order-status'));
  assert.equal(get.status, 405);
});

test('product search: finds milk, case-insensitive', async () => {
  const body = await read(await search('q=MILK'));
  assert.equal(body.count, 1);
  assert.equal(body.products[0]._id, 'P001');
});

test('product search: category filter and inStockOnly', async () => {
  const dairy = await read(await search('category=dairy'));
  assert.equal(dairy.count, 3);
  const all = await read(await search('category=beverages'));
  assert.equal(all.count, 1);
  const inStock = await read(await search('category=beverages&inStockOnly=true'));
  assert.equal(inStock.count, 0); // Cola is out of stock in the seed data
});

test('product search: regex characters are treated as plain text', async () => {
  const body = await read(await search('q=.*'));
  assert.equal(body.count, 0);
});

test('product search: limit works and bad input is 400', async () => {
  const body = await read(await search('category=dairy&limit=2'));
  assert.equal(body.count, 2);
  assert.equal((await search('')).status, 400);
});
