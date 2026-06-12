// Reset to a blank slate so you can re-run the live demo ("merchant texts in →
// shop appears") from scratch — even from the same WhatsApp number, whose shop
// would otherwise still exist (shops.phone is unique, so a repeat message just
// edits it). Deleting shops cascades to their products and orders.
// Run with `pnpm demo:reset` and DATABASE_URL set.

import { getDb, schema } from '../src/db/index.js';

const deleted = await getDb().delete(schema.shops).returning({ id: schema.shops.id });
console.log(
  `demo:reset: deleted ${deleted.length} shop(s) and all their products + orders. Blank slate.`,
);
process.exit(0);
