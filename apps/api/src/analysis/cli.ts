import { join } from "node:path";

import { z } from "zod";

import { loadConfig } from "../config.js";
import { createDatabaseConnection } from "../database/connection.js";
import { applyMigrations } from "../database/migrate.js";
import { ReferenceStorage } from "../storage/reference-storage.js";
import { exportPendingAnalysis, importAnalysisFiles } from "./files.js";

try {
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
      const result = await exportPendingAnalysis(connection,
        new ReferenceStorage(config.storageRoot), config.analysisDataDirectory);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.unavailable.length > 0) process.exitCode = 1;
    } else {
      const result = await importAnalysisFiles(connection,
        join(config.analysisDataDirectory, "analysis-results"), args.length === 2);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.failed > 0) process.exitCode = 1;
    }
  } finally {
    connection.sqlite.close();
  }
} catch (error) {
  const message = error instanceof z.ZodError
    ? "Invalid analysis command or arguments. Only import accepts --overwrite-protected."
    : error instanceof Error ? error.message : "Analysis command failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
