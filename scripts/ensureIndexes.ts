// Creates the database index that blocks duplicate active refunds.
// Safe to run any number of times. Run: npm run db:indexes
import { closeDb, ensureIndexes } from '../lib/db.js';

try {
  await ensureIndexes();
  console.log('OK: indexes are in place.');
} catch (err) {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
