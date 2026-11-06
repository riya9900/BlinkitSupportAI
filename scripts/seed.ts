// Loads FAKE sample data into MongoDB.
// Run:   npm run seed             (only works on an empty database)
//        npm run seed -- --reset  (deletes existing data in the 6 collections first)
import { closeDb, collections, ensureIndexes, getDb } from '../lib/db.js';
import { customers, orders, products, refunds } from './seedData.js';

const reset = process.argv.includes('--reset');

async function main() {
  const db = await getDb();
  console.log(`Connected. Database: "${db.databaseName}"`);

  const names = ['customers', 'orders', 'products', 'refunds', 'queries', 'handoffs'];
  const counts: Record<string, number> = {};
  for (const n of names) counts[n] = await db.collection(n).countDocuments();
  const hasData = Object.values(counts).some((c) => c > 0);

  if (hasData && !reset) {
    console.error('Refusing to seed: the database already has data:', counts);
    console.error('Re-run with "npm run seed -- --reset" to wipe these 6 collections first.');
    process.exitCode = 1;
    return;
  }
  if (reset) {
    for (const n of names) await db.collection(n).deleteMany({});
    console.log('Reset: cleared the 6 project collections.');
  }

  await (await collections.customers()).insertMany(customers);
  await (await collections.products()).insertMany(products);
  await (await collections.orders()).insertMany(orders);
  await (await collections.refunds()).insertMany(refunds);

  // queries and handoffs start empty; create them so they show up in Atlas.
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  for (const n of ['queries', 'handoffs']) {
    if (!existing.has(n)) await db.createCollection(n);
  }

  await ensureIndexes();

  console.log(
    `Inserted: ${customers.length} customers, ${products.length} products, ` +
      `${orders.length} orders, ${refunds.length} refunds.`,
  );
}

main()
  .catch((err) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
