import type { FastifyInstance } from "fastify";

import {
  healthResponseSchema,
  type HealthResponse,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";

const apiVersion = "0.1.0";

export async function registerHealthRoute(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  app.get("/api/v1/health", async (): Promise<HealthResponse> => {
    const row = connection.sqlite
      .prepare("select 1 as healthy")
      .get() as { healthy: number } | undefined;

    if (row?.healthy !== 1) {
      throw new Error("Database readiness check failed");
    }

    return healthResponseSchema.parse({
      status: "ok",
      service: "retr0vault-api",
      version: apiVersion,
      timestamp: new Date().toISOString(),
      database: "ready",
    });
  });
}
