import { readFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";
import { sql, type SQL } from "drizzle-orm";

import { rowsOf, type Db } from "../database/connection.js";
import type { BlobStore } from "../storage/blob-store.js";
import { locateLocally } from "../storage/local-copy.js";
import { archiveTables, columnsOf, type ColumnInfo } from "./archive-migration.js";

/*
 * `npm run cloud:backup`: the database as one SQLite file in the archive's
 * format, so `npm run cloud:migrate -- --sqlite <file>` restores it into an
 * empty project, and any SQLite viewer can open it. Optionally, a local copy
 * of every file in the bucket, fetched incrementally.
 */

const archiveSchema = readFileSync(new URL("./sqlite-archive-schema.sql", import.meta.url), "utf8");

/** A column read back in the archive's conventions: epoch milliseconds, 0/1, JSON text. */
function exported(column: ColumnInfo): SQL {
  const name = sql.identifier(column.name);
  switch (column.type) {
    case "timestamp with time zone":
      return sql`(extract(epoch from ${name}) * 1000)::bigint::text`;
    case "boolean":
      return sql`${name}::int`;
    case "jsonb":
    case "uuid":
    case "bigint":
      return sql`${name}::text`;
    default:
      return sql`${name}`;
  }
}

function toArchiveValue(value: unknown, column: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (column.type === "timestamp with time zone" || column.type === "bigint") return Number(value);
  return value;
}

export interface BackupReport {
  readonly path: string;
  readonly tables: Array<{ table: string; rows: number }>;
}

/** Writes every archive table to a new SQLite file at `path` from one consistent snapshot. */
export async function backupDatabase(db: Db, path: string): Promise<BackupReport> {
  const archive = new Database(path, { fileMustExist: false });
  try {
    if ((archive.prepare("select count(*) as count from sqlite_master").get() as { count: number }).count > 0) {
      throw new Error("The backup file already exists and is not empty");
    }
    archive.exec(archiveSchema);
    const tables: BackupReport["tables"] = [];
    await db.transaction(async (transaction) => {
      const columns = await columnsOf(transaction);
      for (const table of archiveTables) {
        const archiveColumns = new Set((archive.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name));
        const selected = (columns.get(table) ?? []).filter((column) => archiveColumns.has(column.name));
        const rows = rowsOf<Record<string, unknown>>(await transaction.execute(sql`
          select ${sql.join(selected.map((column) => sql`${exported(column)} as ${sql.identifier(column.name)}`), sql`, `)}
          from ${sql.identifier(table)}`));
        const insert = archive.prepare(`insert into "${table}" (${selected.map((column) => `"${column.name}"`).join(", ")})
          values (${selected.map(() => "?").join(", ")})`);
        archive.transaction(() => {
          for (const row of rows) insert.run(...selected.map((column) => toArchiveValue(row[column.name], column)));
        })();
        tables.push({ table, rows: rows.length });
      }
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    return { path, tables };
  } finally {
    archive.close();
  }
}

/** Brings a local folder up to date with every archive file in the store; returns counts. */
export async function mirrorFiles(blobs: BlobStore, directory: string, log: (line: string) => void = () => undefined) {
  let files = 0;
  let bytes = 0;
  for (const prefix of ["originals/", "thumbnails/", "captures/", "motion/"]) {
    for await (const object of blobs.list(prefix)) {
      await locateLocally(blobs, object.key, join(directory, object.key));
      files += 1;
      bytes += object.size;
      if (files % 50 === 0) log(`  ${files} files checked`);
    }
  }
  return { files, bytes };
}
