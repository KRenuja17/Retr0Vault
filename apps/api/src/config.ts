import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { S3BlobStoreConfig } from "./storage/s3-blob-store.js";

/** An optional setting; left blank (as in a copied `.env.example`) it counts as not set. */
const optionalText = () => z.preprocess((value) => (value === "" ? undefined : value), z.string().trim().min(1).optional());

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.enum(["127.0.0.1", "localhost"]).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4611),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: optionalText(),
  STORAGE_ROOT: z.string().trim().min(1).optional(),
  ANALYSIS_DATA_DIR: z.string().trim().min(1).optional(),
  CAPTURE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(45_000),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(200 * 1_024 * 1_024)
    .default(25 * 1_024 * 1_024),
  MAX_MOTION_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1_024 * 1_024)
    .max(1_024 * 1_024 * 1_024)
    .default(300 * 1_024 * 1_024),
  MOTION_PROCESS_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(1_800_000).default(300_000),
  FFMPEG_PATH: z.string().trim().min(1).optional(),
  FFPROBE_PATH: z.string().trim().min(1).optional(),
  S3_ENDPOINT: z.preprocess((value) => (value === "" ? undefined : value), z.url({ protocol: /^https$/u }).optional()),
  S3_REGION: optionalText(),
  S3_BUCKET: optionalText(),
  S3_ACCESS_KEY_ID: optionalText(),
  S3_SECRET_ACCESS_KEY: optionalText(),
});

const objectStorageVariables = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Loads the repository's `.env` (database URL, bucket keys) into the process
 * environment. Called by the server and the command-line tools, never by
 * tests, so a test run cannot reach the real database. Variables already set
 * in the environment are left as they are.
 */
export function loadRepositoryEnvironment(): void {
  const path = join(repositoryRoot, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

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
  /** Postgres connection string (Supabase session pooler); required unless a connection is supplied. */
  readonly databaseUrl: string | undefined;
  /** The private bucket for files; when absent, files stay under `storageRoot`. */
  readonly objectStorage: S3BlobStoreConfig | undefined;
  readonly storageRoot: string;
  readonly maxUploadBytes: number;
  readonly analysisDataDirectory: string;
  readonly captureTimeoutMs: number;
  readonly maxMotionUploadBytes: number;
  readonly motionProcessTimeoutMs: number;
  /** Explicit binary overrides; the bundled npm binaries are used when absent. */
  readonly ffmpegPath: string | undefined;
  readonly ffprobePath: string | undefined;
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

  const configuredStorageRoot = result.data.STORAGE_ROOT ?? "storage";
  const data = result.data;
  const presentStorageVariables = objectStorageVariables.filter((name) => data[name] !== undefined);
  // Half a bucket configuration is a mistake, not a request for local files.
  if (presentStorageVariables.length > 0 && presentStorageVariables.length < objectStorageVariables.length) {
    const missing = objectStorageVariables.filter((name) => data[name] === undefined);
    throw new Error(`Invalid environment configuration: object storage also needs ${missing.join(", ")}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    databaseUrl: result.data.DATABASE_URL,
    objectStorage: presentStorageVariables.length === 0 ? undefined : {
      endpoint: data.S3_ENDPOINT!,
      region: data.S3_REGION!,
      bucket: data.S3_BUCKET!,
      accessKeyId: data.S3_ACCESS_KEY_ID!,
      secretAccessKey: data.S3_SECRET_ACCESS_KEY!,
    },
    storageRoot: isAbsolute(configuredStorageRoot)
      ? configuredStorageRoot
      : resolve(repositoryRoot, configuredStorageRoot),
    maxUploadBytes: result.data.MAX_UPLOAD_BYTES,
    analysisDataDirectory: resolve(repositoryRoot, result.data.ANALYSIS_DATA_DIR ?? "data"),
    captureTimeoutMs: result.data.CAPTURE_TIMEOUT_MS,
    maxMotionUploadBytes: result.data.MAX_MOTION_UPLOAD_BYTES,
    motionProcessTimeoutMs: result.data.MOTION_PROCESS_TIMEOUT_MS,
    ffmpegPath: result.data.FFMPEG_PATH === undefined ? undefined : resolve(result.data.FFMPEG_PATH),
    ffprobePath: result.data.FFPROBE_PATH === undefined ? undefined : resolve(result.data.FFPROBE_PATH),
  };
}
