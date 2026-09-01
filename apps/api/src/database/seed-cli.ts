import { loadConfig } from "../config.js";
import { createDatabaseConnection } from "./connection.js";
import { applyMigrations } from "./migrate.js";
import { clearDevelopmentData, seedDevelopmentData } from "./seed.js";

const config = loadConfig();
const connection = createDatabaseConnection(config.databasePath);
const shouldClear = process.argv.includes("--clear");

try {
  applyMigrations(connection);
  const result = shouldClear
    ? clearDevelopmentData(connection)
    : seedDevelopmentData(connection);
  const action = shouldClear ? "Removed" : "Seeded";
  process.stdout.write(
    `${action} ${result.designTypes} design types and ${result.collections} collections\n`,
  );
} finally {
  connection.sqlite.close();
}
