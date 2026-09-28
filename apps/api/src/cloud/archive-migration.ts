import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import Database from "better-sqlite3";
import { sql, type SQL } from "drizzle-orm";

import { rowsOf, type Db } from "../database/connection.js";
import { contentTypeFor, type BlobStore } from "../storage/blob-store.js";
import type { LocalBlobStore } from "../storage/local-blob-store.js";

/*
 * Phase C6: moves the pre-cloud archive (the SQLite database and the files
 * under storage/) into Postgres and the bucket.
 *
 * - Rows keep every ID, date, status, protection list and analysis. They are
 *   copied in foreign-key order in one transaction, so a failure leaves
 *   Postgres as it was; a row whose key is already there is left alone, so
 *   running again copies only what is missing.
 * - Files keep their keys (the paths the rows already name). A file already
 *   in the bucket with the same bytes is skipped; one with different bytes is
 *   reported and never overwritten.
 * - A dry run does the same work and then rolls the transaction back and
 *   uploads nothing, so every row is checked against the real constraints.
 * - Nothing local is changed.
 */

/** Parents before children, so foreign keys hold as rows arrive. */
export const archiveTables = [
  "design_types", "design_type_rules", "design_type_vocabulary", "collections", "references", "tags",
  "reference_tags", "collection_references", "reference_frames", "motion_studies", "motion_clips",
  "motion_keyframes", "motion_study_tags", "app_metadata",
] as const;

const filePrefixes = ["originals/", "thumbnails/", "captures/", "motion/"] as const;

/** Names only an interrupted operation leaves behind; they are not archive content. */
const leftoverPattern = /(?:^|\/)\.gitkeep$|\.(?:incoming|previous|tmp|part)$|\.part\.mp4$/u;

export interface TableReport {
  readonly table: string;
  /** Rows in the SQLite archive. */
  readonly source: number;
  /** Rows this run added. */
  readonly inserted: number;
  /** Archive rows whose key Postgres holds after the run. */
  readonly present: number;
}

export interface FileReport {
  readonly key: string;
  readonly size: number;
  readonly sha256: string;
  readonly status: "uploaded" | "already-present" | "would-upload" | "differs" | "failed";
  readonly detail?: string;
}

export interface ArchiveMigrationReport {
  readonly dryRun: boolean;
  readonly tables: TableReport[];
  readonly files: FileReport[];
  readonly skippedFiles: string[];
  readonly ok: boolean;
}

export interface ArchiveMigrationOptions {
  readonly sqlitePath: string;
  readonly source: LocalBlobStore;
  readonly target: BlobStore;
  readonly db: Db;
  readonly dryRun: boolean;
  readonly log?: (line: string) => void;
}

class DryRunRollback extends Error {}

interface ColumnInfo {
  readonly name: string;
  readonly type: string;
}

async function hashFile(path: string): Promise<{ sha256: string; md5: string }> {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  for await (const chunk of createReadStream(path)) {
    sha256.update(chunk as Buffer);
    md5.update(chunk as Buffer);
  }
  return { sha256: sha256.digest("hex"), md5: md5.digest("hex") };
}

async function hashStored(store: BlobStore, key: string): Promise<string> {
  const sha256 = createHash("sha256");
  const { body } = await store.read(key);
  for await (const chunk of body) sha256.update(chunk as Buffer);
  return sha256.digest("hex");
}

/** Whether the stored object holds exactly these bytes. */
async function sameObject(store: BlobStore, key: string, size: number, hashes: { sha256: string; md5: string }): Promise<boolean | undefined> {
  const info = await store.head(key);
  if (info === undefined) return undefined;
  if (info.size !== size) return false;
  // A single-part upload's ETag is the MD5 of its bytes; anything else is checked by reading it back.
  const etag = info.version.replace(/^W\//u, "").replaceAll('"', "").toLowerCase();
  if (/^[0-9a-f]{32}$/u.test(etag)) return etag === hashes.md5;
  return (await hashStored(store, key)) === hashes.sha256;
}

/**
 * A SQLite value as the text Postgres parses for a column of `type`. Values
 * travel as text and are cast in SQL, so neither driver reinterprets them.
 */
function convert(value: unknown, column: ColumnInfo, table: string): string | null {
  if (value === null || value === undefined) return null;
  switch (column.type) {
    case "timestamp with time zone": {
      const milliseconds = Number(value);
      if (!Number.isFinite(milliseconds)) throw new Error(`${table}.${column.name}: not a millisecond timestamp`);
      return new Date(milliseconds).toISOString();
    }
    case "boolean":
      return value === 1 || value === "1" || value === true ? "true" : "false";
    case "jsonb":
      if (typeof value !== "string") throw new Error(`${table}.${column.name}: JSON must be stored as text`);
      JSON.parse(value); // Fail on malformed JSON with the column named.
      return value;
    default:
      return String(value);
  }
}

/** Rows a raw INSERT affected, for both drivers. */
function affected(result: unknown): number {
  const candidate = result as { count?: unknown; affectedRows?: unknown };
  return Number(candidate.count ?? candidate.affectedRows ?? 0);
}

async function columnsOf(db: Db): Promise<Map<string, ColumnInfo[]>> {
  const rows = rowsOf<{ table: string; name: string; type: string }>(await db.execute(sql`
    select table_name as "table", column_name as name, data_type as type from information_schema.columns
    where table_schema = 'public' order by table_name, ordinal_position`));
  const columns = new Map<string, ColumnInfo[]>();
  for (const row of rows) columns.set(row.table, [...(columns.get(row.table) ?? []), { name: row.name, type: row.type }]);
  return columns;
}

async function primaryKeysOf(db: Db): Promise<Map<string, string[]>> {
  const rows = rowsOf<{ table: string; name: string }>(await db.execute(sql`
    select c.relname as "table", a.attname as name from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary and n.nspname = 'public'
    order by c.relname, array_position(i.indkey::int2[], a.attnum)`));
  const keys = new Map<string, string[]>();
  for (const row of rows) keys.set(row.table, [...(keys.get(row.table) ?? []), row.name]);
  return keys;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

const valueList = (values: SQL[]) => sql`(${sql.join(values, sql`, `)})`;

async function copyRows(
  db: Db,
  archive: Database.Database,
  log: (line: string) => void,
): Promise<TableReport[]> {
  const columns = await columnsOf(db);
  const primaryKeys = await primaryKeysOf(db);
  const reports: TableReport[] = [];
  for (const table of archiveTables) {
    const target = columns.get(table);
    if (target === undefined) throw new Error(`Postgres has no ${table} table; run the migrations first`);
    const rows = archive.prepare(`select * from "${table}"`).all() as Array<Record<string, unknown>>;
    const sourceColumns = (archive.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name);
    const unknown = sourceColumns.filter((name) => !target.some((column) => column.name === name));
    if (unknown.length > 0) throw new Error(`${table}: Postgres has no column for ${unknown.join(", ")}`);
    const copied = target.filter((column) => sourceColumns.includes(column.name));
    const typed = (row: Record<string, unknown>, column: ColumnInfo) =>
      sql`(${convert(row[column.name], column, table)}::text)::${sql.raw(column.type)}`;

    let inserted = 0;
    for (const batch of chunks(rows, 200)) {
      const values = batch.map((row) => valueList(copied.map((column) => typed(row, column))));
      inserted += affected(await db.execute(sql`
        insert into ${sql.identifier(table)} (${sql.join(copied.map((column) => sql.identifier(column.name)), sql`, `)})
        values ${sql.join(values, sql`, `)}
        on conflict do nothing`));
    }

    // Which archive rows Postgres now holds, matched on the primary key.
    const key = (primaryKeys.get(table) ?? []).map((name) => target.find((column) => column.name === name)!);
    let present = 0;
    if (key.length === 0) {
      present = Math.min(rows.length, Number(rowsOf<{ count: number }>(
        await db.execute(sql`select count(*)::int as count from ${sql.identifier(table)}`))[0]?.count ?? 0));
    } else {
      for (const batch of chunks(rows, 200)) {
        const keys = batch.map((row) => valueList(key.map((column) => typed(row, column))));
        const [row] = rowsOf<{ count: number }>(await db.execute(sql`
          select count(*)::int as count from ${sql.identifier(table)} as target
          join (values ${sql.join(keys, sql`, `)}) as archive (${sql.join(key.map((column) => sql.identifier(column.name)), sql`, `)})
          on ${sql.join(key.map((column) => sql`target.${sql.identifier(column.name)} = archive.${sql.identifier(column.name)}`), sql` and `)}`));
        present += Number(row?.count ?? 0);
      }
    }
    reports.push({ table, source: rows.length, inserted, present });
    log(`  ${table}: ${rows.length} in the archive, ${inserted} added, ${present} present`);
  }
  // The triggers keep search current as rows arrive; rebuild once more for certainty.
  await db.execute(sql`select rv_refresh_reference_search(id) from "references"`);
  await db.execute(sql`select rv_refresh_motion_search(id) from motion_studies`);
  return reports;
}

async function copyFiles(options: ArchiveMigrationOptions, log: (line: string) => void): Promise<{ files: FileReport[]; skipped: string[] }> {
  const files: FileReport[] = [];
  const skipped: string[] = [];
  for (const prefix of filePrefixes) {
    for await (const object of options.source.list(prefix)) {
      if (leftoverPattern.test(object.key)) {
        skipped.push(object.key);
        continue;
      }
      const path = await options.source.localPath(object.key);
      const hashes = await hashFile(path);
      const record = { key: object.key, size: object.size, sha256: hashes.sha256 };
      try {
        const existing = await sameObject(options.target, object.key, object.size, hashes);
        if (existing === true) {
          files.push({ ...record, status: "already-present" });
        } else if (existing === false) {
          files.push({ ...record, status: "differs", detail: "the bucket holds different bytes under this key; left as it is" });
        } else if (options.dryRun) {
          files.push({ ...record, status: "would-upload" });
        } else {
          await options.target.writeFile(object.key, path, { contentType: contentTypeFor(object.key) });
          const verified = await sameObject(options.target, object.key, object.size, hashes);
          files.push(verified === true
            ? { ...record, status: "uploaded" }
            : { ...record, status: "failed", detail: "the uploaded copy does not match" });
          log(`  uploaded ${object.key} (${object.size} bytes)`);
        }
      } catch (error) {
        files.push({ ...record, status: "failed", detail: error instanceof Error ? error.message : "upload failed" });
      }
    }
  }
  return { files, skipped };
}

export async function migrateArchive(options: ArchiveMigrationOptions): Promise<ArchiveMigrationReport> {
  const log = options.log ?? (() => undefined);
  const archive = new Database(options.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    // Files first: once a row exists, the file it names should already be there.
    log(options.dryRun ? "Files (dry run: nothing is uploaded)" : "Files");
    const { files, skipped } = await copyFiles(options, log);

    log(options.dryRun ? "Rows (dry run: checked, then rolled back)" : "Rows");
    let tables: TableReport[] = [];
    try {
      await options.db.transaction(async (transaction) => {
        tables = await copyRows(transaction, archive, log);
        if (options.dryRun) throw new DryRunRollback();
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }

    // In a dry run `present` counts rows as they stood before the rollback.
    const rowsOk = tables.length === archiveTables.length && tables.every((table) => table.present === table.source);
    const filesOk = files.every((file) => file.status === "uploaded" || file.status === "already-present" ||
      (options.dryRun && file.status === "would-upload"));
    return { dryRun: options.dryRun, tables, files, skippedFiles: skipped, ok: rowsOk && filesOk };
  } finally {
    archive.close();
  }
}
