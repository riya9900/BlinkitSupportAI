// Loads FAKE sample data into MongoDB.
// Run:   npm run seed             (only works on an empty database)
//        npm run seed -- --reset  (deletes existing data in the 6 collections first)
//
// SAFETY: every run (with or without --reset) refuses unless MONGODB_DB is explicitly set to a
// local/test/dev database and the database we really connected to has that same name.
import { closeDb, collections, ensureIndexes, getDb } from '../lib/db.js';
import { readEnv } from '../lib/env.js';
import { customers, orders, products, refunds } from './seedData.js';
import { assertSeedAllowed } from './testOrderTools.js';

const reset = process.argv.includes('--reset');

async function main() {
  // SAFETY, check 1: look at the setting BEFORE even connecting.
  assertSeedAllowed(readEnv('MONGODB_DB'));

  const db = await getDb();
  console.log(`Connected. Database: "${db.databaseName}"`);
  // SAFETY, check 2: the database we really connected to must be the one MONGODB_DB names.
  // Nothing below (counting, deleting, inserting) runs unless this passes.
  assertSeedAllowed(readEnv('MONGODB_DB'), db.databaseName);

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
