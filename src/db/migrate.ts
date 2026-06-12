// Applies pending SQL migrations (drizzle/*.sql) at startup. Idempotent: drizzle
// records applied migrations in a __drizzle_migrations table and skips them on
// later boots, so this is safe to run every time the process starts.
//
// Called non-blocking from index.ts — a DB problem logs but never stops the
// process, so /healthz and the MCP `ping` keep serving even if Postgres is down
// or still provisioning (preserves the M0 risk guarantee from PLAN.md).

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb } from './index.js';

export async function runMigrations(): Promise<void> {
  // Folder is resolved from the process cwd (repo root), where `drizzle/` lives.
  await migrate(getDb(), { migrationsFolder: 'drizzle' });
}
