import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  collectionMembershipInputSchema,
  createCollectionSchema,
  updateCollectionSchema,
} from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
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
import { assertOwnedCollections, assertOwnedReference } from "../services/ownership.js";
import { requireUser } from "./auth.js";

const idParametersSchema = z.object({ id: z.uuid() }).strict();
const membershipParametersSchema = z
  .object({ id: z.uuid(), referenceId: z.uuid() })
  .strict();

export async function registerCollectionRoutes(
  app: FastifyInstance,
  db: Db,
): Promise<void> {
  app.get("/api/v1/collections", async (request) => await listCollections(db, requireUser(request).id));

  app.post("/api/v1/collections", async (request, reply) => {
    const input = parseRequest(createCollectionSchema, request.body);
    const collection = await createCollection(db, input, undefined, requireUser(request).id);
    return reply.status(201).send(collection);
  });

  app.patch("/api/v1/collections/:id", async (request) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    const input = parseRequest(updateCollectionSchema, request.body);
    await assertOwnedCollections(db, [id], requireUser(request).id);
    return await updateCollection(db, id, input);
  });

  app.delete("/api/v1/collections/:id", async (request, reply) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    await assertOwnedCollections(db, [id], requireUser(request).id);
    await deleteCollection(db, id);
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
      const owner = requireUser(request).id;
      await assertOwnedCollections(db, [id], owner);
      await assertOwnedReference(db, referenceId, owner);
      await addReferenceToCollection(db, id, referenceId, input.sortOrder);
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
      const owner = requireUser(request).id;
      await assertOwnedCollections(db, [id], owner);
      await assertOwnedReference(db, referenceId, owner);
      await removeReferenceFromCollection(db, id, referenceId);
      return reply.status(204).send();
    },
  );
}
