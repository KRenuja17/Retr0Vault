import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { designDirectionExportRequestSchema, referenceExportRequestSchema } from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import type { MarkdownFile } from "../export/markdown.js";
import { parseRequest } from "../http/validation.js";
import { exportDesignDirection, exportReferences } from "../services/exports.js";

function sendMarkdown(reply: FastifyReply, file: MarkdownFile) {
  return reply.type("text/markdown; charset=utf-8")
    .header("Content-Disposition", `attachment; filename="${file.filename}"`)
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .send(file.content);
}

export async function registerExportRoutes(app: FastifyInstance, connection: DatabaseConnection): Promise<void> {
  const options = { bodyLimit: 2 * 1_024 * 1_024 };
  app.post("/api/v1/export/references", options, async (request, reply) => {
    parseRequest(z.object({}).strict(), request.query);
    const input = parseRequest(referenceExportRequestSchema, request.body);
    return sendMarkdown(reply, exportReferences(connection, input));
  });
  app.post("/api/v1/export/design-direction", options, async (request, reply) => {
    parseRequest(z.object({}).strict(), request.query);
    const input = parseRequest(designDirectionExportRequestSchema, request.body);
    return sendMarkdown(reply, exportDesignDirection(connection, input));
  });
}
