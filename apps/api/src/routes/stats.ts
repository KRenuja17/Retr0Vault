import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../database/connection.js";
import { parseRequest } from "../http/validation.js";
import { getStats } from "../services/stats.js";

export async function registerStatsRoute(app: FastifyInstance, db: Db): Promise<void> {
  app.get("/api/v1/stats", async (request) => {
    parseRequest(z.object({}).strict(), request.query);
    return await getStats(db);
  });
}
