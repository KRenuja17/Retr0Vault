import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { MotionImportResult } from "@retr0vault/shared";

import { readBoundedJson, writeGeneratedFile } from "../analysis/files.js";
import { loadConfig } from "../config.js";
import { createDatabaseConnection, type DatabaseConnection } from "../database/connection.js";
import { applyMigrations } from "../database/migrate.js";
import { failedMotionResult, getPendingMotion, importMotionAnalyses, motionReport } from "../services/motion-analysis.js";
import { MotionStorage } from "../storage/motion-storage.js";

/*
 * Motion curator workflow, mirroring analysis:export-pending / analysis:import:
 *
 *   npm run motion:export-pending   → data/motion-inbox/manifest.json + instructions.md
 *   npm run motion:import           ← data/motion-results/<referenceId>.json
 */

const guidePath = fileURLToPath(new URL("../../../../docs/motion-analysis.md", import.meta.url));

export async function exportPendingMotion(connection: DatabaseConnection, storage: MotionStorage, dataDirectory: string) {
  const manifest = await getPendingMotion(connection, storage, join(dataDirectory, "motion-results"));
  const guide = await readFile(guidePath, "utf8");
  const inbox = join(dataDirectory, "motion-inbox");
  await mkdir(inbox, { recursive: true });
  if ((await lstat(inbox)).isSymbolicLink()) throw new Error("Motion inbox must not be a symbolic link");
  await writeGeneratedFile(inbox, "instructions.md", guide);
  await writeGeneratedFile(inbox, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath: join(inbox, "manifest.json"), exported: manifest.studies.length, unavailable: manifest.unavailable };
}

export async function importMotionFiles(connection: DatabaseConnection, resultsDirectory: string, overwriteProtected = false) {
  let entries;
  try {
    if ((await lstat(resultsDirectory)).isSymbolicLink()) throw new Error("Motion results directory must not be a symbolic link");
    entries = await readdir(resultsDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return motionReport([]);
    throw error;
  }
  const results: MotionImportResult[] = [];
  const seen = new Set<string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.name.toLowerCase().endsWith(".json") || entry.isDirectory()) continue;
    try {
      // One bounded document in memory at a time; `seen` spans the whole directory.
      const value = await readBoundedJson(join(resultsDirectory, entry.name));
      results.push(...importMotionAnalyses(connection, [{ source: entry.name, value }], overwriteProtected, seen).results);
    } catch (error) {
      results.push(failedMotionResult(entry.name, null, "INVALID_RESULT_FILE", error instanceof Error ? error.message : "Result file could not be read"));
    }
  }
  return motionReport(results);
}

async function main(): Promise<void> {
  const args = z.union([
    z.tuple([z.literal("export")]),
    z.tuple([z.literal("import")]),
    z.tuple([z.literal("import"), z.literal("--overwrite-protected")]),
  ]).parse(process.argv.slice(2));
  const config = loadConfig();
  const connection = createDatabaseConnection(config.databasePath);
  try {
    applyMigrations(connection);
    if (args[0] === "export") {
      const result = await exportPendingMotion(connection, new MotionStorage(config.storageRoot), config.analysisDataDirectory);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.unavailable.length > 0) process.exitCode = 1;
    } else {
      const result = await importMotionFiles(connection, join(config.analysisDataDirectory, "motion-results"), args.length === 2);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.failed > 0) process.exitCode = 1;
    }
  } finally {
    connection.sqlite.close();
  }
}

// Run only as a script, so tests can import the helpers above.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof z.ZodError
      ? "Invalid motion command or arguments. Only import accepts --overwrite-protected."
      : error instanceof Error ? error.message : "Motion command failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
