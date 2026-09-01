import { loadConfig } from "../config.js";
import { createDatabaseConnection } from "./connection.js";
import { applyMigrations } from "./migrate.js";

const config = loadConfig();
const connection = createDatabaseConnection(config.databasePath);

try {
  applyMigrations(connection);
  process.stdout.write(`Migrations applied to ${config.databasePath}\n`);
} finally {
  connection.sqlite.close();
}
