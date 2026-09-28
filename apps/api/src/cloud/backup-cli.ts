import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describeDatabase, openCliDatabase } from "../database/cli-connection.js";
import { openBlobStore } from "../storage/open-blob-store.js";
import { backupDatabase, mirrorFiles } from "./backup.js";

/*
 * `npm run cloud:backup [-- --files]`
 *
 * Saves the database to data/backups/retr0vault-<date>.db, in the same SQLite
 * format as the pre-cloud archive, so it can be restored into an empty
 * project with `npm run cloud:migrate -- --sqlite <that file>`. With --files it
 * also brings data/backups/files/ up to date with the bucket (only new or
 * changed files are downloaded); restore those with `--storage data/backups/files`.
 */

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--files")) {
  process.stderr.write("Usage: npm run cloud:backup -- [--files]\n");
  process.exit(1);
}
const say = (line: string) => process.stdout.write(`${line}\n`);
const directory = join(repositoryRoot, "data", "backups");
mkdirSync(directory, { recursive: true });

const { config, connection } = await openCliDatabase();
try {
  const path = join(directory, `retr0vault-${new Date().toISOString().replaceAll(":", "-")}.db`);
  say(`Backing up ${describeDatabase(config.databaseUrl)}`);
  const report = await backupDatabase(connection.database, path);
  for (const table of report.tables) say(`  ${table.table}: ${table.rows} rows`);
  say(`Saved ${path}`);

  if (args.includes("--files")) {
    const blobs = openBlobStore(config);
    try {
      say(`Mirroring ${blobs.description} into ${join(directory, "files")}`);
      const mirrored = await mirrorFiles(blobs, join(directory, "files"), say);
      say(`  ${mirrored.files} files (${(mirrored.bytes / 1_048_576).toFixed(1)} MB) up to date`);
    } finally {
      blobs.close?.();
    }
  }
} finally {
  await connection.close();
}
