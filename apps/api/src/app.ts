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
import { registerDesignTypeRoutes } from "./routes/design-types.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerReferenceRoutes } from "./routes/references.js";
import { ReferenceStorage } from "./storage/reference-storage.js";

export interface BuildAppOptions {
  readonly config?: AppConfig;
  readonly databasePath?: string;
  readonly migrationsFolder?: string;
  readonly logger?: FastifyServerOptions["logger"];
  readonly storageRoot?: string;
  readonly maxUploadBytes?: number;
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
    logger: options.logger ?? { level: config.logLevel },
  });
  const connection = createDatabaseConnection(
    options.databasePath ?? config.databasePath,
  );
  const storage = new ReferenceStorage(
    options.storageRoot ?? config.storageRoot,
  );

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
        `Route ${request.method} ${request.url} was not found`,
      ),
    );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    const code =
      typeof error.code === "string"
        ? error.code
        : statusCode === 500
          ? "INTERNAL_SERVER_ERROR"
          : "REQUEST_ERROR";
    const message =
      statusCode === 500 && config.nodeEnv === "production"
        ? "An unexpected error occurred"
        : error.message;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "Request failed");
    }

    return reply
      .status(statusCode)
      .send(errorPayload(request.id, statusCode, code, message));
  });

  await app.register(multipart, {
    limits: {
      fileSize: options.maxUploadBytes ?? config.maxUploadBytes,
      files: 1,
      fields: 20,
      parts: 21,
    },
    throwFileSizeLimit: true,
  });

  await registerHealthRoute(app, connection);
  await registerDesignTypeRoutes(app, connection);
  await registerCollectionRoutes(app, connection);
  await registerReferenceRoutes(app, connection, storage);

  return app;
}
