// Quick connectivity test. Run: npm run db:check
import { closeDb, getDb } from '../lib/db.js';

try {
  const db = await getDb();
  await db.command({ ping: 1 });
  console.log(`OK: connected to MongoDB, database "${db.databaseName}".`);
} catch (err) {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
