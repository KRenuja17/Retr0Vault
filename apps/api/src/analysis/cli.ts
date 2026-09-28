import { z } from "zod";

import { openCliDatabase } from "../database/cli-connection.js";
import { analysisCommandSchema, runAnalysisCommand } from "./files.js";

try {
  const command = analysisCommandSchema.parse(process.argv.slice(2));
  const { config, connection } = await openCliDatabase();
  try {
    const { result, ok } = await runAnalysisCommand(command, connection.database, config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
    if (!ok) process.exitCode = 1;
  } finally {
    await connection.close();
  }
} catch (error) {
  const message = error instanceof z.ZodError
    ? "Invalid analysis command or arguments. Only import accepts --overwrite-protected."
    : error instanceof Error ? error.message : "Analysis command failed";
  process.stderr.write(`${message}
`);
  process.exitCode = 1;
}
