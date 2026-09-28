import { loadConfig, loadRepositoryEnvironment, type AppConfig } from "../config.js";
import { openPostgres, type DatabaseConnection } from "./connection.js";

/**
 * The database for a command-line tool: reads the repository `.env`, opens
 * `DATABASE_URL` with one connection and brings the schema up to date.
 */
export async function openCliDatabase(): Promise<{ config: AppConfig; connection: DatabaseConnection }> {
  loadRepositoryEnvironment();
  const config = loadConfig();
  if (config.databaseUrl === undefined) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase connection string.");
  }
  const connection = openPostgres(config.databaseUrl, { max: 1 });
  try {
    await connection.migrate();
  } catch (error) {
    await connection.close().catch(() => undefined);
    throw error;
  }
  return { config, connection };
}

/** Where a connection string points, without its password. */
export function describeDatabase(url: string | undefined): string {
  if (url === undefined) return "(no DATABASE_URL)";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
