import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { databaseSchema } from "./schema.js";

/*
 * Phase C: one Postgres-shaped connection for the whole API.
 *
 * - `openPostgres(url)` talks to Supabase (or any Postgres) through postgres.js,
 *   over TLS, with a small pool. The session pooler supports prepared
 *   statements; set `prepare: false` for the transaction pooler (Phase V).
 * - `openPglite()` runs Postgres in-process (WebAssembly) for tests: no server,
 *   no network, a fresh database per call.
 *
 * Services only see `database`, typed against the shared schema, so they do not
 * care which of the two they were given.
 */

export type Schema = typeof databaseSchema;
export type PgDatabaseHandle = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface PgConnection {
  readonly kind: "postgres" | "pglite";
  readonly database: PgDatabaseHandle;
  migrate(migrationsFolder?: string): Promise<void>;
  close(): Promise<void>;
}

export const defaultPgMigrationsFolder = fileURLToPath(new URL("../../../drizzle-pg", import.meta.url));

export interface PostgresOptions {
  /** Pool size; the local API needs few connections. */
  readonly max?: number;
  /** Required for Supabase's transaction pooler, which cannot hold prepared statements. */
  readonly prepare?: boolean;
}

export function openPostgres(url: string, options: PostgresOptions = {}): PgConnection {
  const client = postgres(url, {
    ssl: "require",
    max: options.max ?? 5,
    prepare: options.prepare ?? true,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  const database = drizzlePostgres(client, { schema: databaseSchema }) as unknown as PgDatabaseHandle;
  return {
    kind: "postgres",
    database,
    migrate: (migrationsFolder = defaultPgMigrationsFolder) =>
      migratePostgres(drizzlePostgres(client, { schema: databaseSchema }), { migrationsFolder }),
    close: () => client.end({ timeout: 5 }),
  };
}

export async function openPglite(): Promise<PgConnection> {
  const client = new PGlite();
  await client.waitReady;
  const drizzled = drizzlePglite(client, { schema: databaseSchema });
  return {
    kind: "pglite",
    database: drizzled as unknown as PgDatabaseHandle,
    migrate: (migrationsFolder = defaultPgMigrationsFolder) => migratePglite(drizzled, { migrationsFolder }),
    close: () => client.close(),
  };
}
