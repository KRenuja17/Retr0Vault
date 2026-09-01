import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createImageReferenceFieldsSchema,
  referenceListQuerySchema,
  updateReferenceSchema,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";
import {
  createImageReferenceRecord,
  deleteReferenceRecord,
  getReference,
  listReferences,
  updateReference,
} from "../services/references.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";

const idParametersSchema = z.object({ id: z.uuid() }).strict();

async function readImageMultipart(
  request: FastifyRequest,
): Promise<{ fields: Record<string, unknown>; buffer: Buffer }> {
  if (!request.isMultipart()) {
    throw new ApiError(
      415,
      "MULTIPART_REQUIRED",
      "Image uploads must use multipart/form-data",
    );
  }

  const fields: Record<string, unknown> = {};
  let buffer: Buffer | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        part.file.resume();
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "The image file must use multipart field 'file'",
        );
      }
      if (buffer !== undefined) {
        part.file.resume();
        throw new ApiError(
          400,
          "TOO_MANY_FILES",
          "Exactly one image file must be uploaded",
        );
      }
      buffer = await part.toBuffer();
      if (part.file.truncated) {
        throw new ApiError(
          413,
          "UPLOAD_TOO_LARGE",
          "The uploaded image exceeds the configured size limit",
        );
      }
    } else {
      if (Object.hasOwn(fields, part.fieldname)) {
        throw new ApiError(
          400,
          "DUPLICATE_MULTIPART_FIELD",
          `Multipart field '${part.fieldname}' was provided more than once`,
        );
      }
      fields[part.fieldname] = part.value;
    }
  }

  if (buffer === undefined || buffer.length === 0) {
    throw new ApiError(
      400,
      "IMAGE_FILE_REQUIRED",
      "Exactly one image file must be uploaded",
    );
  }

  return { fields, buffer };
}

export async function registerReferenceRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
  storage: ReferenceStorage,
): Promise<void> {
  app.post("/api/v1/references/image", async (request, reply) => {
    const { fields, buffer } = await readImageMultipart(request);
    const input = parseRequest(createImageReferenceFieldsSchema, fields);
    const id = randomUUID();
    const metadata = await storage.inspectImage(buffer);
    const storedImage = await storage.storeImage(id, buffer, metadata);

    try {
      const reference = createImageReferenceRecord(
        connection,
        id,
        input,
        storedImage,
      );
      return reply.status(201).send(reference);
    } catch (error) {
      const cleanup = await storage.rollbackStoredImage(id, storedImage);
      if (cleanup.warnings.length > 0) {
        request.log.warn(
          { referenceId: id, warnings: cleanup.warnings },
          "Reference creation failed with file rollback warnings",
        );
      }
      throw error;
    }
  });

  app.get("/api/v1/references", async (request) => {
    const query = parseRequest(referenceListQuerySchema, request.query);
    return listReferences(connection, query);
  });

  app.get("/api/v1/references/:id", async (request) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    return getReference(connection, id);
  });

  app.patch("/api/v1/references/:id", async (request) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    const input = parseRequest(updateReferenceSchema, request.body);
    return updateReference(connection, id, input);
  });

  app.delete("/api/v1/references/:id", async (request, reply) => {
    const { id } = parseRequest(idParametersSchema, request.params);
    const deleted = deleteReferenceRecord(connection, id);
    const cleanup = await storage.deleteReferenceFiles(
      deleted.id,
      deleted.originalPath,
      deleted.thumbnailPath,
    );
    if (cleanup.warnings.length > 0) {
      request.log.warn(
        { referenceId: id, warnings: cleanup.warnings },
        "Reference database row deleted with file cleanup warnings",
      );
    }
    return reply.status(204).send();
  });
}
