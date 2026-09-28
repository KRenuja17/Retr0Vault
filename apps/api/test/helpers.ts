import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";

import type { CreateDesignTypeInput } from "@retr0vault/shared";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { CaptureService } from "../src/capture/service.js";
import {
  defaultMigrationsFolder,
  openPglite,
  rowsOf,
  type DatabaseConnection,
  type Db,
} from "../src/database/connection.js";
import type { MotionTools } from "../src/motion/ffmpeg.js";
import type { ClipProcessor } from "../src/motion/queue.js";

export interface TestAppContext {
  readonly app: FastifyInstance;
  /** The app's in-process Postgres; it outlives app restarts, as Supabase would. */
  readonly connection: DatabaseConnection;
  readonly db: Db;
  readonly directory: string;
  readonly storageRoot: string;
}

let migratedSnapshot: Promise<Blob> | undefined;

/** A migrated database image, for tests that need a private database. */
function migratedDataDir(): Promise<Blob> {
  migratedSnapshot ??= (async () => {
    const template = new PGlite();
    try {
      await migrate(drizzle(template), { migrationsFolder: defaultMigrationsFolder });
      return await template.dumpDataDir("none");
    } finally {
      await template.close();
    }
  })();
  return migratedSnapshot;
}

/** A private, fully migrated in-memory database (slower: prefer `createTestDatabase`). */
export async function createIsolatedTestDatabase(): Promise<DatabaseConnection> {
  return openPglite({ loadDataDir: await migratedDataDir() });
}

interface SharedDatabase {
  readonly connection: DatabaseConnection;
  /** What the migrations created; anything else was made by a test. */
  readonly tables: readonly string[];
  readonly functions: ReadonlySet<string>;
  leased: boolean;
}

let sharedDatabase: Promise<SharedDatabase> | undefined;

const publicTables = async (db: Db) => (await queryRows<{ name: string }>(db,
  sql`select tablename as name from pg_tables where schemaname = 'public' order by tablename`)).map(({ name }) => name);
const publicFunctions = async (db: Db) => (await queryRows<{ signature: string }>(db, sql`
  select p.oid::regprocedure::text as signature from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).map(({ signature }) => signature);

/**
 * Starting a Postgres per test is slow, so each test worker migrates one and
 * lends it out; returning it empties it (see `resetSharedDatabase`).
 */
function getSharedDatabase(): Promise<SharedDatabase> {
  sharedDatabase ??= (async () => {
    const connection = await openPglite();
    await connection.migrate();
    const db = connection.database;
    const tables = await publicTables(db);
    for (const table of tables) {
      const [row] = await queryRows<{ count: number }>(db, sql`select count(*)::int as count from ${sql.identifier(table)}`);
      // Resetting truncates every table; a migration that seeds rows would need them restored.
      if (row?.count !== 0) throw new Error(`Migrations left rows in ${table}; teach the test reset to restore them`);
    }
    return { connection, tables, functions: new Set(await publicFunctions(db)), leased: false };
  })();
  return sharedDatabase;
}

/** Back to freshly migrated: drop what tests created, then empty every table. */
async function resetSharedDatabase(shared: SharedDatabase): Promise<void> {
  const db = shared.connection.database;
  for (const table of await publicTables(db)) {
    if (!shared.tables.includes(table)) await db.execute(sql`drop table if exists ${sql.identifier(table)} cascade`);
  }
  for (const signature of await publicFunctions(db)) {
    // Dropping a test's trigger function drops its triggers too.
    if (!shared.functions.has(signature)) await db.execute(sql.raw(`drop function if exists ${signature} cascade`));
  }
  await db.execute(sql.raw(`truncate ${shared.tables.map((table) => `"${table}"`).join(", ")} cascade`));
}

/**
 * A fully migrated, empty database for one test. Closing it hands it back
 * (emptied) rather than stopping it; a second database needed at the same
 * time is a private one.
 */
export async function createTestDatabase(): Promise<DatabaseConnection> {
  const shared = await getSharedDatabase();
  if (shared.leased) return createIsolatedTestDatabase();
  shared.leased = true;
  let returned = false;
  return {
    kind: "pglite",
    database: shared.connection.database,
    migrate: (migrationsFolder) => shared.connection.migrate(migrationsFolder),
    close: async () => {
      if (returned) return;
      returned = true;
      try {
        await resetSharedDatabase(shared);
        shared.leased = false;
      } catch (error) {
        // Never lend out a database that could not be emptied.
        sharedDatabase = undefined;
        await shared.connection.close().catch(() => undefined);
        throw error;
      }
    },
  };
}

/** Rows of a raw SQL query, for assertions on what the database holds. */
export async function queryRows<T = Record<string, unknown>>(db: Db, query: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

/**
 * Make every `event` on `table` fail (only rows matching `when`, a trigger
 * condition over NEW/OLD), as a constraint the schema does not have yet would.
 * `errorCode` is the SQLSTATE raised (default: a generic exception).
 */
export async function rejectWrites(
  db: Db,
  table: string,
  event: "INSERT" | "UPDATE" | "DELETE",
  { errorCode = "P0001", when }: { errorCode?: string; when?: string } = {},
): Promise<void> {
  const name = `test_reject_${table}_${event}`.toLowerCase();
  await db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test constraint' USING ERRCODE = '${errorCode}'; END $$`));
  await db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE ${event} ON "${table}" FOR EACH ROW ${when === undefined ? "" : `WHEN (${when}) `}EXECUTE FUNCTION ${name}()`));
}

/** Every row of every table, to assert that a request changed nothing. */
export async function databaseSnapshot(db: Db): Promise<Record<string, unknown[]>> {
  const tables = await queryRows<{ name: string }>(db, sql`
    select table_name as name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  const snapshot: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    const rows = await queryRows<{ row: unknown }>(db,
      sql`select to_jsonb(t) as row from ${sql.identifier(name)} t order by to_jsonb(t)::text`);
    snapshot[name] = rows.map(({ row }) => row);
  }
  return snapshot;
}

export async function createTestApp(
  label: string,
  options: {
    readonly maxUploadBytes?: number;
    readonly captureService?: CaptureService;
    readonly motionTools?: MotionTools | null;
    readonly motionProcessor?: ClipProcessor;
    readonly maxMotionUploadBytes?: number;
    /** Restart on an earlier app's database and files (close that app first). */
    readonly reuse?: TestAppContext;
    /** Use this directory for files (the database starts fresh). */
    readonly directory?: string;
  } = {},
): Promise<TestAppContext> {
  const directory = options.reuse?.directory ?? options.directory ?? mkdtempSync(join(tmpdir(), `retr0vault-${label}-`));
  const storageRoot = join(directory, "storage");
  const connection = options.reuse?.connection ?? await createTestDatabase();
  try {
    const app = await buildApp({
      config: loadConfig({ ...process.env, ANALYSIS_DATA_DIR: join(directory, "data") }),
      connection,
      storageRoot,
      logger: false,
      // Tests talk to the app in process and never listen.
      motionQueueStart: "ready",
      ...(options.captureService === undefined ? {} : { captureService: options.captureService }),
      ...(options.motionTools === undefined ? {} : { motionTools: options.motionTools }),
      ...(options.motionProcessor === undefined ? {} : { motionProcessor: options.motionProcessor }),
      ...(options.maxMotionUploadBytes === undefined ? {} : { maxMotionUploadBytes: options.maxMotionUploadBytes }),
      ...(options.maxUploadBytes === undefined
        ? {}
        : { maxUploadBytes: options.maxUploadBytes }),
    });
    return { app, connection, db: connection.database, directory, storageRoot };
  } catch (error) {
    if (options.reuse === undefined) await connection.close();
    throw error;
  }
}

export async function disposeTestApp(context: TestAppContext): Promise<void> {
  await context.app.close();
  await context.connection.close();
  rmSync(context.directory, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 50,
  });
}

export const validDesignTypeInput: CreateDesignTypeInput = {
  name: "Editorial Signal",
  slug: "editorial-signal",
  description: "Editorial hierarchy organized around a clear visual signal.",
  deployFor: "Studios and publications.",
  risk: "Excessive annotation can overpower the main content.",
  briefBlock: "Use a disciplined editorial grid with one signal accent.",
  principles: ["Lead with a clear editorial hierarchy"],
  avoid: ["Avoid decorative metadata without purpose"],
  vocabulary: ["editorial grid", "signal accent"],
};

interface MultipartPayloadOptions {
  readonly fields?: Readonly<Record<string, string>>;
  readonly file?: {
    readonly buffer: Buffer;
    readonly filename?: string;
    readonly fieldname?: string;
    readonly contentType?: string;
  };
}

export function createMultipartPayload(options: MultipartPayloadOptions): {
  readonly headers: Record<string, string>;
  readonly payload: Buffer;
} {
  const boundary = `retr0vault-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const append = (value: string) => chunks.push(Buffer.from(value, "utf8"));

  for (const [name, value] of Object.entries(options.fields ?? {})) {
    append(`--${boundary}\r\n`);
    append(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    append(`${value}\r\n`);
  }

  if (options.file !== undefined) {
    const filename = (options.file.filename ?? "reference.png").replaceAll(
      '"',
      "",
    );
    append(`--${boundary}\r\n`);
    append(
      `Content-Disposition: form-data; name="${options.file.fieldname ?? "file"}"; filename="${filename}"\r\n`,
    );
    append(
      `Content-Type: ${options.file.contentType ?? "application/octet-stream"}\r\n\r\n`,
    );
    chunks.push(options.file.buffer);
    append("\r\n");
  }

  append(`--${boundary}--\r\n`);

  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}
