import { mkdirSync } from "node:fs";
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
 * Retr0Vault's database connection (Phase C: Postgres).
 *
 * - `openPostgres(url)` talks to Supabase (or any Postgres) through postgres.js,
 *   over TLS, with a small pool. The session pooler supports prepared
 *   statements; pass `prepare: false` for the transaction pooler.
 * - `openPglite()` runs Postgres in-process (WebAssembly) for tests: no server
 *   and no network.
 *
 * Services take a `Db`: either `connection.database` or an open transaction,
 * so work started in a transaction keeps reading through it.
 */

export type Schema = typeof databaseSchema;
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export interface DatabaseConnection {
  readonly kind: "postgres" | "pglite";
  readonly database: Db;
  migrate(migrationsFolder?: string): Promise<void>;
  close(): Promise<void>;
}

export const defaultMigrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface PostgresOptions {
  /** Pool size; the local API needs few connections. */
  readonly max?: number;
  /** Required for Supabase's transaction pooler, which cannot hold prepared statements. */
  readonly prepare?: boolean;
}

export function openPostgres(url: string, options: PostgresOptions = {}): DatabaseConnection {
  const client = postgres(url, {
    ssl: "require",
    max: options.max ?? 5,
    prepare: options.prepare ?? true,
    connect_timeout: 15,
    idle_timeout: 60,
    onnotice: () => undefined,
  });
  const drizzled = drizzlePostgres(client, { schema: databaseSchema });
  let closed = false;
  return {
    kind: "postgres",
    database: drizzled as unknown as Db,
    migrate: (migrationsFolder = defaultMigrationsFolder) => migratePostgres(drizzled, { migrationsFolder }),
    close: async () => {
      if (closed) return;
      closed = true;
      await client.end({ timeout: 5 });
    },
  };
}

export interface PgliteOptions {
  /** Keep the data in this directory; in memory when omitted. */
  readonly dataDirectory?: string;
  /** Start from a `dumpDataDir()` snapshot (tests reuse one migrated database). */
  readonly loadDataDir?: Blob;
}

export async function openPglite(options: PgliteOptions = {}): Promise<DatabaseConnection> {
  if (options.dataDirectory !== undefined) mkdirSync(options.dataDirectory, { recursive: true });
  const client = new PGlite({
    ...(options.dataDirectory === undefined ? {} : { dataDir: options.dataDirectory }),
    ...(options.loadDataDir === undefined ? {} : { loadDataDir: options.loadDataDir }),
  });
  await client.waitReady;
  const drizzled = drizzlePglite(client, { schema: databaseSchema });
  let closed = false;
  return {
    kind: "pglite",
    database: drizzled as unknown as Db,
    migrate: (migrationsFolder = defaultMigrationsFolder) => migratePglite(drizzled, { migrationsFolder }),
    close: async () => {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}

/** Rows of a raw `db.execute(sql…)` result, for both drivers. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
