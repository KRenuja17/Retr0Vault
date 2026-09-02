import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AnalysisImportResult } from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import {
  analysisReport, failedAnalysisResult, getPendingAnalysis, importAnalyses,
  type AnalysisEntry,
} from "../services/analysis.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";

const guidePath = fileURLToPath(new URL("../../../../docs/analysis-schema.md", import.meta.url));
export const maximumAnalysisFileBytes = 2 * 1_024 * 1_024;

async function writeGeneratedFile(directory: string, name: string, contents: string) {
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
  connection: DatabaseConnection,
  storage: ReferenceStorage,
  dataDirectory: string,
) {
  const manifest = await getPendingAnalysis(connection, storage, join(dataDirectory, "analysis-results"));
  const guide = await readFile(guidePath, "utf8");
  const inbox = join(dataDirectory, "analysis-inbox");
  await mkdir(inbox, { recursive: true });
  if ((await lstat(inbox)).isSymbolicLink()) throw new Error("Analysis inbox must not be a symbolic link");
  await writeGeneratedFile(inbox, "instructions.md", guide);
  await writeGeneratedFile(inbox, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath: join(inbox, "manifest.json"), exported: manifest.references.length, unavailable: manifest.unavailable };
}

async function readBoundedJson(path: string): Promise<unknown> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Result must be a regular JSON file, not a link");
  const handle = await open(path, "r");
  try {
    if ((await handle.stat()).size > maximumAnalysisFileBytes) throw new Error("Analysis file exceeds 2 MiB");
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
  connection: DatabaseConnection,
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
  const entries: AnalysisEntry[] = [];
  const failures: AnalysisImportResult[] = [];
  for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.name.toLowerCase().endsWith(".json") || entry.isDirectory()) continue;
    try {
      entries.push({ source: entry.name, value: await readBoundedJson(join(resultsDirectory, entry.name)) });
    } catch (error) {
      failures.push(failedAnalysisResult(entry.name, null, "INVALID_RESULT_FILE",
        error instanceof Error ? error.message : "Result file could not be read"));
    }
  }
  const imported = importAnalyses(connection, entries, overwriteProtected);
  return analysisReport([...imported.results, ...failures].sort((a, b) => a.source.localeCompare(b.source, "en")));
}
