// Lazy Drizzle client. The connection is only established on first use, so the
// M0 walking skeleton (healthz + MCP `ping`) boots and serves even when
// DATABASE_URL is unset or the DB is still provisioning.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | undefined;

export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — database access is unavailable.');
  }
  const client = postgres(url, { max: 5 });
  _db = drizzle(client, { schema });
  return _db;
}

export { schema };
