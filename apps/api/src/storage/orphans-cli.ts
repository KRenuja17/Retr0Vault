import { lstatSync } from "node:fs";
import { loadConfig } from "../config.js";
import { createDatabaseConnection } from "../database/connection.js";
import { maintainOrphanFiles } from "./orphans.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--quarantine") || args.length > 1) {
  throw new Error("Usage: npm run storage:orphans -- [--quarantine]");
}
const config = loadConfig();
// Never create an empty database and mistake a missing catalogue for orphans.
const databaseEntry = lstatSync(config.databasePath);
if (!databaseEntry.isFile() || databaseEntry.isSymbolicLink()) throw new Error("An existing regular database file is required");
const connection = createDatabaseConnection(config.databasePath);
try {
  process.stdout.write(`${JSON.stringify(maintainOrphanFiles(connection, config.storageRoot, args.includes("--quarantine")), null, 2)}\n`);
} finally {
  connection.sqlite.close();
}
