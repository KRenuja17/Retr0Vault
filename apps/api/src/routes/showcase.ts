import { desc, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { showcaseResponseSchema } from "@retr0vault/shared";

import { rowsOf, type Db } from "../database/connection.js";
import { references } from "../database/schema.js";
import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";
import { getReferenceMediaPaths } from "../services/references.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";

const SHOWCASE_SIZE = 16;

/*
 * The front door is shown before anyone signs in, and its contact strip runs
 * the archive's newest plates, whichever account filed them. So these two
 * routes are public: a list of the newest plates (ids, titles, dates) with the
 * archive's totals, and their thumbnails. Nothing else of a reference is.
 */
export async function registerShowcaseRoutes(app: FastifyInstance, db: Db, storage: ReferenceStorage): Promise<void> {
  app.get("/api/v1/showcase", async (request) => {
    parseRequest(z.object({}).strict(), request.query);
    const [newest, counts] = await Promise.all([
      db.select({ id: references.id, title: references.title, updatedAt: references.updatedAt })
        .from(references).orderBy(desc(references.createdAt), desc(references.id)).limit(SHOWCASE_SIZE),
      db.execute(sql`
        select (select count(*)::integer from "references") as plates,
          (select count(*)::integer from motion_studies) as "motionStudies",
          (select count(distinct design_type_id)::integer from "references" where design_type_id is not null) as "designTypes"
      `).then((result) => rowsOf<{ plates: number; motionStudies: number; designTypes: number }>(result)),
    ]);
    return showcaseResponseSchema.parse({
      references: newest.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
      counts: counts[0],
    });
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/api/v1/showcase/:referenceId/thumbnail",
    handler: async (request, reply) => {
      const { referenceId } = parseRequest(z.object({ referenceId: z.uuid().toLowerCase() }).strict(), request.params);
      parseRequest(z.object({ v: z.string().max(64).optional() }).strict(), request.query);
      const reference = await getReferenceMediaPaths(db, referenceId);
      const media = await storage.openReferenceImage(reference.id, reference.thumbnailPath, "thumbnail").catch(() => {
        throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested reference media is unavailable");
      });
      reply.header("Cache-Control", "private, max-age=0, must-revalidate").header("ETag", media.etag)
        .type(media.contentType).header("Content-Length", media.size);
      if (request.method === "HEAD") {
        media.body.destroy();
        return reply.send();
      }
      return await reply.send(media.body);
    },
  });
}
