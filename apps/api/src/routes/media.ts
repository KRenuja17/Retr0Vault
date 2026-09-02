import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { DatabaseConnection } from "../database/connection.js";
import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";
import { getReferenceMediaPaths } from "../services/references.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";

const parametersSchema = z.object({ referenceId: z.uuid().toLowerCase() }).strict();
const querySchema = z.object({}).strict();

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  // GET/HEAD use weak comparison, including a list of previously cached tags.
  return header.split(",").some((value) => value.trim().replace(/^W\//u, "") === etag.slice(2));
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  storage: ReferenceStorage,
): Promise<void> {
  for (const kind of ["thumbnail", "original"] as const) {
    app.route({
      method: ["GET", "HEAD"],
      url: `/api/v1/media/:referenceId/${kind}`,
      onError: async (_request, reply) => {
        if (!reply.raw.headersSent) {
          for (const name of ["Content-Type", "Content-Length", "ETag"]) {
            reply.removeHeader(name);
            reply.raw.removeHeader(name);
          }
          reply.header("Cache-Control", "no-store");
        }
      },
      handler: async (request, reply) => {
        const { referenceId } = parseRequest(parametersSchema, request.params);
        parseRequest(querySchema, request.query);
        const reference = getReferenceMediaPaths(connection, referenceId);
        const path = kind === "thumbnail" ? reference.thumbnailPath : reference.originalPath;
        const media = await storage.openReferenceImage(reference.id, path, kind).catch(() => {
          // Missing, unreadable and unsafe paths are indistinguishable over HTTP.
          throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested reference media is unavailable");
        });
        try {
          // Revalidate even after a previous successful response: deleted references
          // and missing files must not produce a long-lived cached success or 304.
          reply.header("Cache-Control", "private, max-age=0, must-revalidate")
            .header("ETag", media.etag);
          if (matchesEtag(request.headers["if-none-match"], media.etag)) return reply.code(304).send();
          reply.type(media.contentType).header("Content-Length", media.size);
          if (request.method === "HEAD") return reply.send();
          // Await response completion/abort before closing the verified handle.
          return await reply.send(media.file.createReadStream({ autoClose: false }));
        } finally {
          await media.file.close();
        }
      },
    });
  }
}
