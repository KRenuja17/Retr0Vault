import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import multipart from "@fastify/multipart";

import type { ErrorResponse } from "@retr0vault/shared";

import { type AppConfig, loadConfig } from "./config.js";
import { openPostgres, type DatabaseConnection } from "./database/connection.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerDesignTypeRoutes } from "./routes/design-types.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerReferenceRoutes } from "./routes/references.js";
import { registerStatsRoute } from "./routes/stats.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerLocalAccess } from "./http/local-access.js";
import type { SessionUser } from "./auth/sessions.js";
import { registerAuth } from "./routes/auth.js";
import { registerShowcaseRoutes } from "./routes/showcase.js";
import { ApiError, isTransientDatabaseError } from "./errors.js";
import { ReferenceStorage } from "./storage/reference-storage.js";
import { ChromiumCaptureService, type CaptureService } from "./capture/service.js";
import { resolveMotionTools, type MotionTools } from "./motion/ffmpeg.js";
import { MotionQueue, type ClipProcessor } from "./motion/queue.js";
import { registerMotionRoutes } from "./routes/motion.js";
import type { BlobStore } from "./storage/blob-store.js";
import { LocalBlobStore } from "./storage/local-blob-store.js";
import { MotionStorage } from "./storage/motion-storage.js";
import { openBlobStore } from "./storage/open-blob-store.js";

export interface BuildAppOptions {
  readonly config?: AppConfig;
  /**
   * A database connection to use instead of opening `DATABASE_URL` (tests pass
   * an in-process PGlite). The caller keeps ownership and closes it.
   */
  readonly connection?: DatabaseConnection;
  readonly migrationsFolder?: string;
  readonly logger?: FastifyServerOptions["logger"];
  /** Keep files in this local folder (tests); otherwise the configured bucket or storage folder. */
  readonly storageRoot?: string;
  /** A store to use for files instead (tests); it wins over `storageRoot`. */
  readonly blobStore?: BlobStore;
  readonly maxUploadBytes?: number;
  readonly captureService?: CaptureService;
  /** `null` simulates missing ffmpeg/ffprobe; undefined resolves them from config. */
  readonly motionTools?: MotionTools | null;
  readonly motionProcessor?: ClipProcessor;
  readonly maxMotionUploadBytes?: number;
  /** When the motion queue recovers and starts work: after listening (default), or on ready for inject-only apps. */
  readonly motionQueueStart?: "listen" | "ready";
  /**
   * Tests only: a request without a session counts as this account, so tests
   * that are not about signing in need not sign in. Never set by the server.
   */
  readonly testUser?: SessionUser;
}

/** How many times startup tries an unreachable database (waits 2, 4 and 8 s between). */
const STARTUP_ATTEMPTS = 4;
/** How often the pool's connections are touched, to keep every one of them open. */
const POOL_WARM_INTERVAL_MS = 4 * 60 * 1_000;

/** Network-level failures reaching Postgres (postgres.js and Node error codes). */
function isDatabaseUnreachable(error: unknown): boolean {
  const codes = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"]);
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && typeof candidate === "object" && candidate !== null; depth += 1) {
    const code = (candidate as { code?: unknown }).code;
    if (typeof code === "string" && codes.has(code)) return true;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

function errorPayload(
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
): ErrorResponse {
  return {
    error: { code, message, statusCode },
    requestId,
  };
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger === false ? false : {
      level: config.logLevel,
      ...(typeof options.logger === "object" ? options.logger : {}),
      // Logs must not contain source URLs, query strings, bodies, or SQL bindings.
      serializers: {
        req: (request: { method: string }) => ({ method: request.method }),
        err: (error: { statusCode?: number }) => ({
          type: "RequestError", message: "Request failed", stack: "", statusCode: error.statusCode ?? 500,
        }),
      },
    },
    requestTimeout: 120_000,
    bodyLimit: 1_048_576,
  });
  const ownsConnection = options.connection === undefined;
  if (ownsConnection && config.databaseUrl === undefined) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill in the Supabase connection string.");
  }
  const connection = options.connection ?? openPostgres(config.databaseUrl!);
  const db = connection.database;
  const blobs: BlobStore = options.blobStore ??
    (options.storageRoot === undefined ? openBlobStore(config) : new LocalBlobStore(options.storageRoot));
  app.addHook("onClose", async () => blobs.close?.());
  const storage = new ReferenceStorage(blobs);
  const captureService = options.captureService ?? new ChromiumCaptureService({ timeoutMs: config.captureTimeoutMs });
  app.addHook("preClose", async () => captureService.close());
  const motionStorage = new MotionStorage(blobs);
  const motionTools = options.motionTools === null ? undefined :
    options.motionTools ?? resolveMotionTools({ ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath });
  const motionQueue = new MotionQueue({
    db, storage: motionStorage, tools: motionTools,
    timeoutMs: config.motionProcessTimeoutMs, logger: app.log,
    ...(options.motionProcessor === undefined ? {} : { processor: options.motionProcessor }),
  });

  // A cloud database can be briefly out of reach (a network blip, a project
  // waking up): try a few times, waiting longer each time, before giving up.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await connection.migrate(options.migrationsFolder);
      break;
    } catch (error) {
      if (ownsConnection && isDatabaseUnreachable(error) && attempt < STARTUP_ATTEMPTS) {
        app.log.warn({ attempt }, "The database is not answering yet; trying again");
        await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** (attempt - 1)));
        continue;
      }
      if (ownsConnection) await connection.close().catch(() => undefined);
      throw error;
    }
  }

  if (ownsConnection) {
    // The hosted database is a long way off and a new connection costs seconds,
    // so the pool is opened before the first request and kept open: warmed now,
    // and again every few minutes, which also reopens any the driver recycled.
    const warm = () => connection.warm?.().catch((error: unknown) => {
      app.log.warn({ err: error }, "Could not warm the database pool");
    });
    void warm();
    const keeper = setInterval(() => void warm(), POOL_WARM_INTERVAL_MS);
    keeper.unref();
    app.addHook("onClose", async () => {
      clearInterval(keeper);
      await connection.close();
    });
  }

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send(
      errorPayload(
        request.id,
        404,
        "ROUTE_NOT_FOUND",
        "The requested route was not found",
      ),
    );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const busy = isTransientDatabaseError(error);
    const unavailable = !busy && isDatabaseUnreachable(error);
    const statusCode = busy || unavailable ? 503 :
      typeof error.statusCode === "number" && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    const internal = statusCode >= 500 && !(error instanceof ApiError);
    const code = busy ? "DATABASE_BUSY" : unavailable ? "DATABASE_UNAVAILABLE" : internal ? "INTERNAL_SERVER_ERROR" :
      typeof error.code === "string"
        ? error.code
        : statusCode === 500
          ? "INTERNAL_SERVER_ERROR"
          : "REQUEST_ERROR";
    const message =
      busy ? "The database is busy; retry the request shortly" :
      unavailable ? "The database cannot be reached; check the connection or whether the Supabase project is paused" : internal
        ? "An unexpected error occurred" : error.message;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "Request failed");
    }

    if (busy || unavailable) reply.header("Retry-After", busy ? "1" : "10");
    return reply.status(statusCode)
      .send(errorPayload(request.id, statusCode, code, message));
  });

  await registerLocalAccess(app, config.port);
  await registerAuth(app, db, {
    secureCookies: config.nodeEnv === "production",
    ...(options.testUser === undefined ? {} : { testUser: options.testUser }),
  });
  await app.register(multipart, {
    limits: {
      fileSize: options.maxUploadBytes ?? config.maxUploadBytes,
      files: 1,
      fields: 20,
      parts: 21,
      fieldSize: 8_192,
      fieldNameSize: 100,
    },
    throwFileSizeLimit: true,
  });

  await registerHealthRoute(app, db);
  await registerShowcaseRoutes(app, db, storage);
  await registerStatsRoute(app, db);
  await registerDesignTypeRoutes(app, db);
  await registerCollectionRoutes(app, db);
  await registerReferenceRoutes(app, db, storage, captureService, motionStorage);
  await registerMediaRoutes(app, db, storage);
  await registerAnalysisRoutes(app, db, storage, config.analysisDataDirectory);
  await registerExportRoutes(app, db);
  await registerMotionRoutes(app, {
    db, storage: motionStorage, queue: motionQueue, tools: motionTools,
    maxUploadBytes: options.maxMotionUploadBytes ?? config.maxMotionUploadBytes,
    dataDirectory: config.analysisDataDirectory,
  });
  /*
   * Claim queued work only once this process owns the port. A second API
   * started by mistake reaches "ready" before its listen fails, and recovering
   * the queue then would reset and re-run clips the live server is processing.
   * In-process test apps never listen, so they opt into starting on ready.
   */
  app.addHook(options.motionQueueStart === "ready" ? "onReady" : "onListen", async () => { await motionQueue.start(); });
  app.addHook("preClose", async () => motionQueue.close());
  app.decorate("motionQueue", motionQueue);

  return app;
}
