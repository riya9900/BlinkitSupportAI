// LOCAL TEST HELPER: marks one fake order as delivered "just now" so you can test the
// return/refund flow. Run: npm run db:deliver            (defaults to ORD1002)
//                          npm run db:deliver -- ORD1002
//
// Safety: it refuses to run unless the database name contains "local", "test" or "dev",
// it changes only this one order, and it never touches the refund rules or refunds.
import { closeDb, collections, getDb } from '../lib/db.js';
import { evaluateRefund } from '../lib/refundRules.js';
import { assertTestDatabase, planDelivery } from './testOrderTools.js';

const orderId = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'ORD1002';

async function main() {
  if (!/^[A-Za-z0-9]{3,20}$/.test(orderId)) throw new Error(`"${orderId}" is not a valid order ID.`);

  const db = await getDb();
  assertTestDatabase(db.databaseName);
  console.log(`Database: "${db.databaseName}"  (looks like a test database, OK)`);

  const orders = await collections.orders();
  const refunds = await (await collections.refunds()).find({ orderId }).toArray();
  const before = await orders.findOne({ _id: orderId });
  const plan = planDelivery(before, refunds, new Date());

  console.log(`Before: ${orderId} status = "${before?.status}", deliveredAt = ${before?.deliveredAt?.toISOString() ?? '(none)'}`);
  const result = await orders.updateOne({ _id: orderId, status: { $ne: 'cancelled' } }, { $set: plan.set });
  if (result.matchedCount !== 1) throw new Error('Nothing was updated.');

  const after = await orders.findOne({ _id: orderId });
  console.log(`After:  ${orderId} status = "${after?.status}", deliveredAt = ${after?.deliveredAt?.toISOString()}`);
  for (const w of plan.warnings) console.warn(`WARNING: ${w}`);

  // Ask the REAL refund rules what they think now.
  if (after) {
    const decision = evaluateRefund(after, refunds, undefined, new Date());
    console.log(
      decision.eligible
        ? `Refund check: ELIGIBLE (${decision.status}, up to Rs ${decision.maxAmount}). Ready to test!`
        : `Refund check: NOT eligible (${decision.code}): ${decision.message}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
