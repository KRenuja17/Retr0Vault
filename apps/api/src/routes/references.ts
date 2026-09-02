import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createImageReferenceFieldsSchema,
  createWebsiteReferenceSchema,
  referenceListQuerySchema,
  updateReferenceSchema,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";
import {
  createImageReferenceRecord,
  createWebsiteReferenceRecord,
  deleteReferenceRecord,
  getReference,
  listReferences,
  updateReference,
} from "../services/references.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";
import type { CaptureService } from "../capture/service.js";
import { validateCaptureUrl } from "../capture/url-policy.js";
import { getDesignTypeById } from "../services/design-types.js";

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

  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
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
      if (part.valueTruncated || part.fieldnameTruncated) {
        throw new ApiError(413, "MULTIPART_FIELD_TOO_LARGE", "An upload field exceeds the size limit");
      }
      if (Object.hasOwn(fields, part.fieldname)) {
        throw new ApiError(
          400,
          "DUPLICATE_MULTIPART_FIELD",
          "A multipart field was provided more than once",
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
  captureService: CaptureService,
): Promise<void> {
  app.post("/api/v1/references/url", async (request, reply) => {
    const input = parseRequest(createWebsiteReferenceSchema, request.body);
    parseRequest(z.object({}).strict(), request.query);
    validateCaptureUrl(input.url);
    if (input.designTypeId !== undefined) getDesignTypeById(connection, input.designTypeId);
    const captured = await captureService.capture(input);
    const id = randomUUID();
    const stored = await storage.storeCapture(id, captured.frames).catch((error: unknown) => {
      request.log.error({ err: error }, "Could not store website capture");
      throw new ApiError(500, "CAPTURE_STORAGE_FAILED", "Could not store captured images; no reference was saved");
    });
    try {
      return reply.status(201).send(createWebsiteReferenceRecord(connection, id, input, stored));
    } catch (error) {
      const cleanup = await storage.deleteReferenceFiles(id, stored.originalPath, stored.thumbnailPath, stored.frames.map((frame) => frame.imagePath));
      if (cleanup.warnings.length > 0) request.log.warn({ referenceId: id, warnings: cleanup.warnings }, "Capture rollback warnings");
      throw error;
    }
  });

  app.post("/api/v1/references/image", async (request, reply) => {
    parseRequest(z.object({}).strict(), request.query);
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
      deleted.framePaths,
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
