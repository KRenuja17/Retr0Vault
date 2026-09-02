import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import { databaseSchema } from "./schema.js";

export interface DatabaseConnection {
  readonly database: BetterSQLite3Database<typeof databaseSchema>;
  readonly sqlite: BetterSqlite3.Database;
}

export function createDatabaseConnection(
  databasePath: string,
): DatabaseConnection {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 1000");
    if (databasePath !== ":memory:") {
      sqlite.pragma("journal_mode = WAL");
    }
    // Persist each committed WAL transaction before reporting success.
    sqlite.pragma("synchronous = FULL");
    const database = drizzle(sqlite, { schema: databaseSchema });
    return { database, sqlite };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
