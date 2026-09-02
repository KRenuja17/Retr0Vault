import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { analysisImportRequestSchema } from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { parseRequest } from "../http/validation.js";
import { getPendingAnalysis, importAnalyses, resetAnalysis } from "../services/analysis.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";

export async function registerAnalysisRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  storage: ReferenceStorage,
  analysisDataDirectory: string,
): Promise<void> {
  app.get("/api/v1/analysis/pending", async (request) => {
    parseRequest(z.object({}).strict(), request.query);
    return getPendingAnalysis(connection, storage, join(analysisDataDirectory, "analysis-results"));
  });

  app.post("/api/v1/analysis/import", { bodyLimit: 2 * 1_024 * 1_024 }, async (request) => {
    const input = parseRequest(analysisImportRequestSchema, request.body);
    return importAnalyses(connection,
      input.analyses.map((value, index) => ({ source: String(index), value })),
      input.overwriteProtected);
  });

  app.post("/api/v1/analysis/:referenceId/reset", async (request) => {
    const { referenceId } = parseRequest(z.object({ referenceId: z.uuid() }).strict(), request.params);
    parseRequest(z.object({}).strict(), request.body ?? {});
    return resetAnalysis(connection, referenceId);
  });
}
