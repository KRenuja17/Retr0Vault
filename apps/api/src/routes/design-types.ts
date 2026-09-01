import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  createDesignTypeSchema,
  slugSchema,
  updateDesignTypeSchema,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { parseRequest } from "../http/validation.js";
import {
  createDesignType,
  deleteDesignType,
  getDesignTypeBySlug,
  listDesignTypes,
  updateDesignType,
} from "../services/design-types.js";

const slugParametersSchema = z.object({ slug: slugSchema }).strict();
const idParametersSchema = z.object({ id: z.uuid() }).strict();

export async function registerDesignTypeRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  app.get("/api/v1/design-types", async () => listDesignTypes(connection));

  app.post("/api/v1/design-types", async (request, reply) => {
    const input = parseRequest(createDesignTypeSchema, request.body);
    const designType = createDesignType(connection, input);
    return reply.status(201).send(designType);
  });

  app.get("/api/v1/design-types/:slug", async (request) => {
    const { slug } = parseRequest(slugParametersSchema, request.params);
    return getDesignTypeBySlug(connection, slug);
  });

  app.patch("/api/v1/design-types/:id", async (request) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    const input = parseRequest(updateDesignTypeSchema, request.body);
    return updateDesignType(connection, id, input);
  });

  app.delete("/api/v1/design-types/:id", async (request, reply) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    deleteDesignType(connection, id);
    return reply.status(204).send();
  });
}
