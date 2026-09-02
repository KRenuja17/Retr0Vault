import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.enum(["127.0.0.1", "localhost"]).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4611),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_PATH: z.string().trim().min(1).optional(),
  STORAGE_ROOT: z.string().trim().min(1).optional(),
  ANALYSIS_DATA_DIR: z.string().trim().min(1).optional(),
  CAPTURE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(45_000),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(200 * 1_024 * 1_024)
    .default(25 * 1_024 * 1_024),
});

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

export interface AppConfig {
  readonly nodeEnv: "development" | "test" | "production";
  readonly host: "127.0.0.1" | "localhost";
  readonly port: number;
  readonly logLevel:
    | "fatal"
    | "error"
    | "warn"
    | "info"
    | "debug"
    | "trace"
    | "silent";
  readonly databasePath: string;
  readonly storageRoot: string;
  readonly maxUploadBytes: number;
  readonly analysisDataDirectory: string;
  readonly captureTimeoutMs: number;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const configuredDatabasePath =
    result.data.DATABASE_PATH ?? "data/retr0vault.db";
  const configuredStorageRoot = result.data.STORAGE_ROOT ?? "storage";

  return {
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    databasePath: isAbsolute(configuredDatabasePath)
      ? configuredDatabasePath
      : resolve(repositoryRoot, configuredDatabasePath),
    storageRoot: isAbsolute(configuredStorageRoot)
      ? configuredStorageRoot
      : resolve(repositoryRoot, configuredStorageRoot),
    maxUploadBytes: result.data.MAX_UPLOAD_BYTES,
    analysisDataDirectory: resolve(repositoryRoot, result.data.ANALYSIS_DATA_DIR ?? "data"),
    captureTimeoutMs: result.data.CAPTURE_TIMEOUT_MS,
  };
}
