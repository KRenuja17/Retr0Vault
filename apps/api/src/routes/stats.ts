import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseConnection } from "../database/connection.js";
import { parseRequest } from "../http/validation.js";
import { getStats } from "../services/stats.js";

export async function registerStatsRoute(app: FastifyInstance, connection: DatabaseConnection): Promise<void> {
  app.get("/api/v1/stats", async (request) => {
    parseRequest(z.object({}).strict(), request.query);
    return getStats(connection);
  });
}
