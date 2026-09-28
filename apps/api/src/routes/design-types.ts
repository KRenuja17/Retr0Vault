import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createDesignTypeSchema,
  slugSchema,
  updateDesignTypeSchema,
} from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
import { parseRequest } from "../http/validation.js";
import {
  createDesignType,
  deleteDesignType,
  getDesignTypeById,
  getDesignTypeBySlug,
  listDesignTypes,
  updateDesignType,
} from "../services/design-types.js";
import { requireUser } from "./auth.js";

const slugParametersSchema = z.object({ slug: slugSchema }).strict();
const idParametersSchema = z.object({ id: z.uuid() }).strict();

export async function registerDesignTypeRoutes(
  app: FastifyInstance,
  db: Db,
): Promise<void> {
  // The taxonomy is shared; each account sees its own reference counts.
  app.get("/api/v1/design-types", async (request) => await listDesignTypes(db, requireUser(request).id));

  app.post("/api/v1/design-types", async (request, reply) => {
    const input = parseRequest(createDesignTypeSchema, request.body);
    const designType = await createDesignType(db, input);
    return reply.status(201).send(await getDesignTypeById(db, designType.id, requireUser(request).id));
  });

  app.get("/api/v1/design-types/:slug", async (request) => {
    const { slug } = parseRequest(slugParametersSchema, request.params);
    return await getDesignTypeBySlug(db, slug, requireUser(request).id);
  });

  app.patch("/api/v1/design-types/:id", async (request) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    const input = parseRequest(updateDesignTypeSchema, request.body);
    await updateDesignType(db, id, input);
    return await getDesignTypeById(db, id, requireUser(request).id);
  });

  app.delete("/api/v1/design-types/:id", async (request, reply) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    await deleteDesignType(db, id);
    return reply.status(204).send();
  });
}
