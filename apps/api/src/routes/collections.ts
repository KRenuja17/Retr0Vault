import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  collectionMembershipInputSchema,
  createCollectionSchema,
  updateCollectionSchema,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { parseRequest } from "../http/validation.js";
import {
  addReferenceToCollection,
  removeReferenceFromCollection,
} from "../services/references.js";
import {
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
} from "../services/collections.js";

const idParametersSchema = z.object({ id: z.uuid() }).strict();
const membershipParametersSchema = z
  .object({ id: z.uuid(), referenceId: z.uuid() })
  .strict();

export async function registerCollectionRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  app.get("/api/v1/collections", async () => listCollections(connection));

  app.post("/api/v1/collections", async (request, reply) => {
    const input = parseRequest(createCollectionSchema, request.body);
    const collection = createCollection(connection, input);
    return reply.status(201).send(collection);
  });

  app.patch("/api/v1/collections/:id", async (request) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    const input = parseRequest(updateCollectionSchema, request.body);
    return updateCollection(connection, id, input);
  });

  app.delete("/api/v1/collections/:id", async (request, reply) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    deleteCollection(connection, id);
    return reply.status(204).send();
  });

  app.post(
    "/api/v1/collections/:id/references/:referenceId",
    async (request, reply) => {
      const { id, referenceId } = parseRequest(
        membershipParametersSchema,
        request.params,
      );
      const input = parseRequest(
        collectionMembershipInputSchema,
        request.body ?? {},
      );
      addReferenceToCollection(connection, id, referenceId, input.sortOrder);
      return reply.status(204).send();
    },
  );

  app.delete(
    "/api/v1/collections/:id/references/:referenceId",
    async (request, reply) => {
      const { id, referenceId } = parseRequest(
        membershipParametersSchema,
        request.params,
      );
      removeReferenceFromCollection(connection, id, referenceId);
      return reply.status(204).send();
    },
  );
}
