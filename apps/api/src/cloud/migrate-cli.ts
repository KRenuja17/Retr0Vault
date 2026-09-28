import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describeDatabase, openCliDatabase } from "../database/cli-connection.js";
import { LocalBlobStore } from "../storage/local-blob-store.js";
import { S3BlobStore } from "../storage/s3-blob-store.js";
import { migrateArchive } from "./archive-migration.js";

/*
 * `npm run cloud:migrate [-- --dry-run] [-- --sqlite <path>] [-- --storage <folder>]` — Phase C6.
 *
 * Copies the SQLite archive (data/retr0vault.db) and the files under the
 * storage folder into Supabase and the bucket named in .env, then prints a
 * verification report and keeps it as JSON under data/cloud-migration/.
 * Safe to run again: it copies only what is missing, and never overwrites.
 * The same command restores a `cloud:backup` (--sqlite) and its file mirror
 * (--storage) into an empty project.
 */

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const valued = ["--sqlite", "--storage"] as const;
const values = new Map<string, string>();
let unknown = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]!;
  if (arg === "--dry-run") continue;
  if ((valued as readonly string[]).includes(arg) && args[index + 1] !== undefined && !values.has(arg)) {
    values.set(arg, args[index + 1]!);
    index += 1;
  } else {
    unknown = true;
  }
}
if (unknown) {
  process.stderr.write("Usage: npm run cloud:migrate -- [--dry-run] [--sqlite <retr0vault.db or backup>] [--storage <folder>]\n");
  process.exit(1);
}
const fromRepository = (path: string) => (isAbsolute(path) ? path : resolve(repositoryRoot, path));
const sqlitePath = fromRepository(values.get("--sqlite") ?? "data/retr0vault.db");

const { config, connection } = await openCliDatabase();
if (config.objectStorage === undefined) {
  await connection.close();
  throw new Error("The bucket is not configured: set the five S3_* values in .env");
}
const source = new LocalBlobStore(values.has("--storage") ? fromRepository(values.get("--storage")!) : config.storageRoot);
const target = new S3BlobStore(config.objectStorage);
const say = (line: string) => process.stdout.write(`${line}\n`);

try {
  say(`${dryRun ? "Dry run: " : ""}moving ${sqlitePath} and ${source.description}`);
  say(`  into ${describeDatabase(config.databaseUrl)} and ${target.description}`);
  const report = await migrateArchive({ sqlitePath, source, target, db: connection.database, dryRun, log: say });

  const count = (status: string) => report.files.filter((file) => file.status === status).length;
  const bytes = report.files.reduce((total, file) => total + file.size, 0);
  say("");
  say("Verification");
  for (const table of report.tables) {
    say(`  ${table.present === table.source ? "ok  " : "MISS"} ${table.table}: ${table.present}/${table.source} rows present`);
  }
  say(`  files: ${report.files.length} (${(bytes / 1_048_576).toFixed(1)} MB) — ${count("uploaded")} uploaded, ` +
    `${count("already-present")} already there${dryRun ? `, ${count("would-upload")} to upload` : ""}`);
  for (const file of report.files.filter((entry) => entry.status === "differs" || entry.status === "failed")) {
    say(`  ${file.status.toUpperCase()} ${file.key}: ${file.detail ?? ""}`);
  }
  if (report.skippedFiles.length > 0) say(`  skipped ${report.skippedFiles.length} leftover file(s) from interrupted operations`);

  const directory = join(repositoryRoot, "data", "cloud-migration");
  mkdirSync(directory, { recursive: true });
  const reportPath = join(directory, `${dryRun ? "dry-run" : "run"}-${new Date().toISOString().replaceAll(":", "-")}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  say("");
  say(`${report.ok ? "All present and verified." : "Not everything is in place; see above."} Report: ${reportPath}`);
  if (!report.ok) process.exitCode = 1;
} finally {
  target.close();
  await connection.close();
}
