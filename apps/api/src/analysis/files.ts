import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnalysisImportResult } from "@retr0vault/shared";
import { z } from "zod";

import type { Db } from "../database/connection.js";
import {
  analysisReport, failedAnalysisResult, getPendingAnalysis, importAnalyses,
} from "../services/analysis.js";
import type { AppConfig } from "../config.js";
import { ReferenceStorage } from "../storage/reference-storage.js";

const guidePath = fileURLToPath(new URL("../../../../docs/analysis-schema.md", import.meta.url));
export const maximumAnalysisFileBytes = 2 * 1_024 * 1_024;

export async function writeGeneratedFile(directory: string, name: string, contents: string) {
  const temporaryPath = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, join(directory, name));
  } finally {
    await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function exportPendingAnalysis(
  db: Db,
  storage: ReferenceStorage,
  dataDirectory: string,
) {
  const manifest = await getPendingAnalysis(db, storage, join(dataDirectory, "analysis-results"));
  const guide = await readFile(guidePath, "utf8");
  const inbox = join(dataDirectory, "analysis-inbox");
  await mkdir(inbox, { recursive: true });
  if ((await lstat(inbox)).isSymbolicLink()) throw new Error("Analysis inbox must not be a symbolic link");
  await writeGeneratedFile(inbox, "instructions.md", guide);
  await writeGeneratedFile(inbox, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath: join(inbox, "manifest.json"), exported: manifest.references.length, unavailable: manifest.unavailable };
}

export async function readBoundedJson(path: string): Promise<unknown> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Result must be a regular JSON file, not a link");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    const current = await lstat(path);
    if (!opened.isFile() || current.isSymbolicLink() || opened.ino !== entry.ino || opened.dev !== entry.dev ||
        opened.ino !== current.ino || opened.dev !== current.dev) throw new Error("Result file changed while opening");
    if (opened.size > maximumAnalysisFileBytes) throw new Error("Analysis file exceeds 2 MiB");
    const buffer = Buffer.alloc(maximumAnalysisFileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const chunk = await handle.read(buffer, length, buffer.length - length, null);
      if (chunk.bytesRead === 0) break;
      length += chunk.bytesRead;
    }
    if (length > maximumAnalysisFileBytes) throw new Error("Analysis file exceeds 2 MiB");
    return JSON.parse(buffer.subarray(0, length).toString("utf8").replace(/^\uFEFF/u, "")) as unknown;
  } finally {
    await handle.close();
  }
}

export async function importAnalysisFiles(
  db: Db,
  resultsDirectory: string,
  overwriteProtected = false,
) {
  let directoryEntries;
  try {
    if ((await lstat(resultsDirectory)).isSymbolicLink()) throw new Error("Analysis results directory must not be a symbolic link");
    directoryEntries = await readdir(resultsDirectory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return analysisReport([]);
    throw error;
  }
  const results: AnalysisImportResult[] = [];
  const seen = new Set<string>();
  for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.name.toLowerCase().endsWith(".json") || entry.isDirectory()) continue;
    try {
      // Keep only one bounded JSON document in memory. The shared set preserves
      // duplicate detection across the entire directory, including failed imports.
      const value = await readBoundedJson(join(resultsDirectory, entry.name));
      results.push(...(await importAnalyses(db, [{ source: entry.name, value }], overwriteProtected, seen)).results);
    } catch (error) {
      results.push(failedAnalysisResult(entry.name, null, "INVALID_RESULT_FILE",
        error instanceof Error ? error.message : "Result file could not be read"));
    }
  }
  return analysisReport(results);
}

/** `analysis:export-pending` and `analysis:import [--overwrite-protected]`. */
export const analysisCommandSchema = z.union([
  z.tuple([z.literal("export")]),
  z.tuple([z.literal("import")]),
  z.tuple([z.literal("import"), z.literal("--overwrite-protected")]),
]);

export type AnalysisCommand = z.infer<typeof analysisCommandSchema>;

/** Runs a curator command; `ok` is false when something was left unexported or unimported. */
export async function runAnalysisCommand(
  command: AnalysisCommand,
  db: Db,
  config: Pick<AppConfig, "storageRoot" | "analysisDataDirectory">,
): Promise<{ result: unknown; ok: boolean }> {
  if (command[0] === "export") {
    const result = await exportPendingAnalysis(db, new ReferenceStorage(config.storageRoot), config.analysisDataDirectory);
    return { result, ok: result.unavailable.length === 0 };
  }
  const result = await importAnalysisFiles(db, join(config.analysisDataDirectory, "analysis-results"), command.length === 2);
  return { result, ok: result.failed === 0 };
}
