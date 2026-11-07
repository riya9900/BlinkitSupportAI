// Pure helpers for the LOCAL test-data script (markOrderDelivered.ts). No database here,
// so they are unit tested in tests/testOrderTools.test.ts.
import type { Order, Refund } from '../lib/types.js';

// Safety guard: test data may only be changed in a database whose name says it is
// for local/test use. This stops the script ever editing the production database
// (named "blinkit_support" by default).
export function assertTestDatabase(databaseName: string): void {
  if (!/(local|test|dev)/i.test(databaseName)) {
    throw new Error(
      `Refusing to run: database "${databaseName}" does not look like a local/test database ` +
        `(its name must contain "local", "test" or "dev"). ` +
        `Set MONGODB_DB=blinkit_support_local in your .env file, run "npm run seed", then try again.`,
    );
  }
}

// Stricter guard for commands that WRITE (every `npm run seed`). Unlike assertTestDatabase, it also
// demands that MONGODB_DB was set EXPLICITLY: a missing/blank value silently falls back to the
// production database name, so it must never be allowed to reach a write or delete.
export function assertSeedAllowed(explicitDatabaseName: string | undefined, actualDatabaseName?: string): void {
  if (!explicitDatabaseName) {
    throw new Error(
      'Refusing to seed: MONGODB_DB is not set in your .env file. Without it the app falls back to the ' +
        'PRODUCTION database. Add a line such as MONGODB_DB=blinkit_support_local to .env and try again.',
    );
  }
  assertTestDatabase(explicitDatabaseName);
  if (actualDatabaseName !== undefined && actualDatabaseName !== explicitDatabaseName) {
    throw new Error(
      `Refusing to seed: MONGODB_DB says "${explicitDatabaseName}" but the connection is using "${actualDatabaseName}".`,
    );
  }
}

export interface DeliveryPlan {
  set: { status: 'delivered'; deliveredAt: Date };
  warnings: string[];
}

// Works out the change that makes an order look like it was just delivered. The refund
// rules are NOT touched: they require status "delivered" AND a deliveredAt inside the
// 48-hour window, so we set both honestly and let the real rules judge the result.
export function planDelivery(order: Order | null, refunds: Refund[], now: Date): DeliveryPlan {
  if (!order) throw new Error('That order does not exist in this database. Did you run "npm run seed"?');
  if (order.status === 'cancelled') throw new Error('That order is cancelled; a cancelled order cannot be delivered.');

  const warnings: string[] = [];
  if (refunds.some((r) => r.status === 'pending' || r.status === 'approved')) {
    warnings.push(
      'This order already has a pending/approved refund, so a new refund request will be refused as ALREADY_REQUESTED. ' +
        'To start clean, run "npm run seed -- --reset" (local test database only).',
    );
  }
  return { set: { status: 'delivered', deliveredAt: now }, warnings };
}
