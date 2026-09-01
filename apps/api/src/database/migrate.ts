import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import type { DatabaseConnection } from "./connection.js";

export const defaultMigrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export function applyMigrations(
  connection: DatabaseConnection,
  migrationsFolder: string = defaultMigrationsFolder,
): void {
  migrate(connection.database, { migrationsFolder });
}
