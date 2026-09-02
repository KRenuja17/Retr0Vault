import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import multipart from "@fastify/multipart";

import type { ErrorResponse } from "@retr0vault/shared";

import { type AppConfig, loadConfig } from "./config.js";
import { createDatabaseConnection } from "./database/connection.js";
import { applyMigrations, defaultMigrationsFolder } from "./database/migrate.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerDesignTypeRoutes } from "./routes/design-types.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerReferenceRoutes } from "./routes/references.js";
import { registerStatsRoute } from "./routes/stats.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerLocalAccess } from "./http/local-access.js";
import { ApiError, sqliteErrorCode } from "./errors.js";
import { ReferenceStorage } from "./storage/reference-storage.js";
import { ChromiumCaptureService, type CaptureService } from "./capture/service.js";

export interface BuildAppOptions {
  readonly config?: AppConfig;
  readonly databasePath?: string;
  readonly migrationsFolder?: string;
  readonly logger?: FastifyServerOptions["logger"];
  readonly storageRoot?: string;
  readonly maxUploadBytes?: number;
  readonly captureService?: CaptureService;
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
  const connection = createDatabaseConnection(
    options.databasePath ?? config.databasePath,
  );
  const storage = new ReferenceStorage(
    options.storageRoot ?? config.storageRoot,
  );
  const captureService = options.captureService ?? new ChromiumCaptureService({ timeoutMs: config.captureTimeoutMs });
  app.addHook("preClose", async () => captureService.close());

  try {
    applyMigrations(
      connection,
      options.migrationsFolder ?? defaultMigrationsFolder,
    );
  } catch (error) {
    connection.sqlite.close();
    throw error;
  }

  app.addHook("onClose", async () => {
    if (connection.sqlite.open) {
      connection.sqlite.close();
    }
  });

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
    const busy = sqliteErrorCode(error)?.startsWith("SQLITE_BUSY") === true;
    const statusCode = busy ? 503 :
      typeof error.statusCode === "number" && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
        ? error.statusCode
        : 500;
    const internal = statusCode >= 500 && !(error instanceof ApiError);
    const code = busy ? "DATABASE_BUSY" : internal ? "INTERNAL_SERVER_ERROR" :
      typeof error.code === "string"
        ? error.code
        : statusCode === 500
          ? "INTERNAL_SERVER_ERROR"
          : "REQUEST_ERROR";
    const message =
      busy ? "The database is busy; retry the request shortly" : internal
        ? "An unexpected error occurred" : error.message;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "Request failed");
    }

    if (busy) reply.header("Retry-After", "1");
    return reply.status(statusCode)
      .send(errorPayload(request.id, statusCode, code, message));
  });

  await registerLocalAccess(app, config.port);
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

  await registerHealthRoute(app, connection);
  await registerStatsRoute(app, connection);
  await registerDesignTypeRoutes(app, connection);
  await registerCollectionRoutes(app, connection);
  await registerReferenceRoutes(app, connection, storage, captureService);
  await registerMediaRoutes(app, connection, storage);
  await registerAnalysisRoutes(app, connection, storage, config.analysisDataDirectory);
  await registerExportRoutes(app, connection);

  return app;
}
