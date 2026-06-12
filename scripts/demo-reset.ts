// Wipe all orders for a clean demo run (keeps shops + products). Run with
// `pnpm demo:reset` and DATABASE_URL set.

import { getDb, schema } from '../src/db/index.js';

const deleted = await getDb().delete(schema.orders).returning({ id: schema.orders.id });
console.log(`demo:reset: deleted ${deleted.length} order(s).`);
process.exit(0);
