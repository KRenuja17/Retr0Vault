import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  clipEnergySchema,
  createMotionClipFieldsSchema,
  motionImportRequestSchema,
  motionListQuerySchema,
  updateMotionClipSchema,
  updateMotionStudySchema,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";
import { motionToolsUnavailable, probeMedia, UnsupportedMediaError, type MotionTools } from "../motion/ffmpeg.js";
import { assertWithinLimits, MotionLimitError } from "../motion/pipeline.js";
import type { MotionQueue } from "../motion/queue.js";
import {
  assertClipCapacity,
  createQueuedClip,
  deleteClipRecord,
  deleteStudyRecord,
  findClipContext,
  getMotionStudy,
  readyClipForMedia,
  requeueClip,
  updateClip,
} from "../services/motion.js";
import {
  getPendingMotion,
  importMotionAnalyses,
  listMotion,
  resetMotionAnalysis,
  updateMotionStudy,
} from "../services/motion-analysis.js";
import type { MotionMediaKind, MotionStorage, OpenMotionFile } from "../storage/motion-storage.js";

const referenceParameters = z.object({ id: z.uuid() }).strict();
const clipParameters = z.object({ clipId: z.uuid().toLowerCase() }).strict();
const emptyQuery = z.object({}).strict();

export interface MotionRouteOptions {
  readonly connection: DatabaseConnection;
  readonly storage: MotionStorage;
  readonly queue: MotionQueue;
  readonly tools: MotionTools | undefined;
  readonly maxUploadBytes: number;
  /** Base data directory; the curator workflow uses its motion-results folder. */
  readonly dataDirectory: string;
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((value) => value.trim().replace(/^W\//u, "") === etag.slice(2));
}

/**
 * One `bytes=` range, as browsers send for video seeking. Multiple ranges are
 * answered with the whole file (allowed by RFC 9110); a malformed header is ignored.
 */
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return "unsatisfiable";
  return { start, end };
}

async function sendMotionFile(
  request: FastifyRequest,
  reply: FastifyReply,
  media: OpenMotionFile,
  ranges: boolean,
): Promise<FastifyReply> {
  try {
    reply.header("Cache-Control", "private, max-age=0, must-revalidate").header("ETag", media.etag)
      .header("X-Content-Type-Options", "nosniff");
    if (ranges) reply.header("Accept-Ranges", "bytes");
    if (matchesEtag(request.headers["if-none-match"], media.etag)) return reply.code(304).send();
    reply.type(media.contentType);
    const range = ranges ? parseByteRange(request.headers.range, media.size) : undefined;
    if (range === "unsatisfiable") {
      return reply.code(416).header("Content-Range", `bytes */${media.size}`).send();
    }
    if (range !== undefined) {
      reply.code(206).header("Content-Range", `bytes ${range.start}-${range.end}/${media.size}`)
        .header("Content-Length", range.end - range.start + 1);
      if (request.method === "HEAD") return reply.send();
      return await reply.send(media.file.createReadStream({ autoClose: false, start: range.start, end: range.end }));
    }
    reply.header("Content-Length", media.size);
    if (request.method === "HEAD") return reply.send();
    return await reply.send(media.file.createReadStream({ autoClose: false }));
  } finally {
    await media.file.close();
  }
}

/** Media errors must not keep headers from a half-built media response, nor be cached. */
async function mediaError(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!reply.raw.headersSent) {
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "ETag", "Accept-Ranges"]) {
      reply.removeHeader(name);
      reply.raw.removeHeader(name);
    }
    reply.header("Cache-Control", "no-store");
  }
}

export async function registerMotionRoutes(app: FastifyInstance, options: MotionRouteOptions): Promise<void> {
  const { connection, storage, queue } = options;

  app.post("/api/v1/references/:id/motion/clips", async (request, reply) => {
    const { id: referenceId } = parseRequest(referenceParameters, request.params);
    parseRequest(emptyQuery, request.query);
    if (!request.isMultipart()) throw new ApiError(415, "MULTIPART_REQUIRED", "Recordings must be uploaded as multipart/form-data");
    if (options.tools === undefined || !queue.available) throw motionToolsUnavailable();
    assertClipCapacity(connection, referenceId);

    const clipId = randomUUID();
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let received = false;
    try {
      for await (const part of request.parts({ limits: { fileSize: options.maxUploadBytes, files: 1, fields: 4 } })) {
        if (part.type === "file") {
          if (part.fieldname !== "file" || received) {
            part.file.resume();
            throw new ApiError(400, "VALIDATION_ERROR", "Upload exactly one recording in the multipart field 'file'");
          }
          await storage.writeUpload(referenceId, clipId, part.file);
          if (part.file.truncated) throw new ApiError(413, "UPLOAD_TOO_LARGE", "The recording exceeds the configured size limit");
          received = true;
        } else {
          if (part.valueTruncated || part.fieldnameTruncated) throw new ApiError(413, "MULTIPART_FIELD_TOO_LARGE", "An upload field exceeds the size limit");
          if (Object.hasOwn(fields, part.fieldname)) throw new ApiError(400, "DUPLICATE_MULTIPART_FIELD", "A multipart field was provided more than once");
          fields[part.fieldname] = part.value;
        }
      }
      if (!received) throw new ApiError(400, "RECORDING_REQUIRED", "Upload exactly one recording in the multipart field 'file'");
      const input = parseRequest(createMotionClipFieldsSchema, fields);
      const source = await storage.existingPath(referenceId, clipId, "source.bin");
      let probe;
      try {
        probe = await probeMedia(options.tools, source);
        assertWithinLimits(probe);
      } catch (error) {
        if (error instanceof MotionLimitError) throw new ApiError(422, "MOTION_OUT_OF_LIMITS", error.message);
        if (error instanceof UnsupportedMediaError) throw new ApiError(415, "UNSUPPORTED_MEDIA", error.message);
        throw error;
      }
      const study = createQueuedClip(connection, {
        referenceId, clipId, label: input.label, posterMs: input.posterMs,
        sourceFormat: `${probe.formatName.split(",")[0]}/${probe.codec}`.slice(0, 60),
        durationMs: probe.durationMs, width: probe.width, height: probe.height, fps: probe.fps,
      });
      queue.enqueue(clipId);
      return reply.status(202).send(study);
    } catch (error) {
      await storage.removeClip(referenceId, clipId);
      const code = (error as { code?: unknown }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") throw new ApiError(413, "UPLOAD_TOO_LARGE", "The recording exceeds the configured size limit");
      if (code === "FST_FILES_LIMIT" || code === "FST_FIELDS_LIMIT" || code === "FST_PARTS_LIMIT") {
        throw new ApiError(400, "VALIDATION_ERROR", "Upload one recording with at most the label and posterMs fields");
      }
      throw error;
    }
  });

  app.get("/api/v1/references/:id/motion", async (request) => {
    const { id } = parseRequest(referenceParameters, request.params);
    parseRequest(emptyQuery, request.query);
    return getMotionStudy(connection, id);
  });

  app.delete("/api/v1/references/:id/motion", async (request, reply) => {
    const { id } = parseRequest(referenceParameters, request.params);
    deleteStudyRecord(connection, id);
    const warnings = await storage.removeStudy(id);
    if (warnings.length > 0) request.log.warn({ referenceId: id, warnings }, "Motion study deleted with file cleanup warnings");
    return reply.status(204).send();
  });

  app.patch("/api/v1/references/:id/motion", async (request) => {
    const { id } = parseRequest(referenceParameters, request.params);
    const input = parseRequest(updateMotionStudySchema, request.body);
    return updateMotionStudy(connection, id, input);
  });

  app.get("/api/v1/motion", async (request) => {
    const query = parseRequest(motionListQuerySchema, request.query);
    return listMotion(connection, query);
  });

  app.get("/api/v1/motion/pending", async (request) => {
    parseRequest(emptyQuery, request.query);
    return getPendingMotion(connection, storage, join(options.dataDirectory, "motion-results"));
  });

  app.post("/api/v1/motion/import", { bodyLimit: 2 * 1_024 * 1_024 }, async (request) => {
    const input = parseRequest(motionImportRequestSchema, request.body);
    return importMotionAnalyses(connection, input.analyses.map((value, index) => ({ source: String(index), value })), input.overwriteProtected);
  });

  app.post("/api/v1/motion/:referenceId/reset", async (request) => {
    const { referenceId } = parseRequest(z.object({ referenceId: z.uuid() }).strict(), request.params);
    parseRequest(emptyQuery, request.body ?? {});
    return resetMotionAnalysis(connection, referenceId);
  });

  app.patch("/api/v1/motion/clips/:clipId", async (request) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    const input = parseRequest(updateMotionClipSchema, request.body);
    return updateClip(connection, clipId, input);
  });

  app.delete("/api/v1/motion/clips/:clipId", async (request, reply) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    const removed = deleteClipRecord(connection, clipId);
    const warnings = await storage.removeClip(removed.referenceId, removed.clipId);
    if (warnings.length > 0) request.log.warn({ clipId, warnings }, "Motion clip deleted with file cleanup warnings");
    return reply.status(204).send();
  });

  app.post("/api/v1/motion/clips/:clipId/retry", async (request, reply) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    parseRequest(emptyQuery, request.body ?? {});
    if (options.tools === undefined || !queue.available) throw motionToolsUnavailable();
    const { clip, study } = findClipContext(connection, clipId);
    if (clip.processingStatus !== "failed") throw new ApiError(409, "MOTION_CLIP_NOT_FAILED", "Only a failed clip can be retried");
    if (!await storage.exists(study.referenceId, clipId, "source.bin")) {
      throw new ApiError(409, "MOTION_SOURCE_MISSING", "The original upload is gone; remove this clip and upload it again");
    }
    requeueClip(connection, clipId);
    queue.enqueue(clipId);
    return reply.status(202).send(getMotionStudy(connection, study.referenceId));
  });

  app.get("/api/v1/motion/clips/:clipId/energy", async (request) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    parseRequest(emptyQuery, request.query);
    const { referenceId } = readyClipForMedia(connection, clipId);
    const path = await storage.existingPath(referenceId, clipId, "energy.json").catch(() => {
      throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
    });
    const parsed = z.object({ sampleFps: z.number(), energy: z.array(z.number()) }).passthrough()
      .parse(JSON.parse(await readFile(path, "utf8")));
    return clipEnergySchema.parse({ sampleFps: parsed.sampleFps, energy: parsed.energy.map((value) => Math.min(1, Math.max(0, value))) });
  });

  const mediaKinds: readonly MotionMediaKind[] = ["clip", "preview", "poster", "energy", "regions", "contact-sheet"];
  for (const kind of mediaKinds) {
    app.route({
      method: ["GET", "HEAD"],
      url: `/api/v1/media/motion/:clipId/${kind}`,
      onError: mediaError,
      handler: async (request, reply) => {
        const { clipId } = parseRequest(clipParameters, request.params);
        parseRequest(emptyQuery, request.query);
        const { referenceId } = readyClipForMedia(connection, clipId);
        const media = await storage.openMedia(referenceId, clipId, kind).catch(() => {
          throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
        });
        return sendMotionFile(request, reply, media, kind === "clip" || kind === "preview");
      },
    });
  }

  for (const kind of ["keyframes", "bursts"] as const) {
    app.route({
      method: ["GET", "HEAD"],
      url: `/api/v1/media/motion/:clipId/${kind}/:index`,
      onError: mediaError,
      handler: async (request, reply) => {
        const { clipId, index } = parseRequest(
          z.object({ clipId: z.uuid().toLowerCase(), index: z.coerce.number().int().min(0).max(kind === "keyframes" ? 23 : 3) }).strict(),
          request.params,
        );
        parseRequest(emptyQuery, request.query);
        const clip = readyClipForMedia(connection, clipId);
        if (index >= (kind === "keyframes" ? clip.keyframeCount : clip.burstCount)) {
          throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
        }
        const media = await storage.openIndexed(clip.referenceId, clipId, kind === "keyframes" ? "keyframe" : "burst", index).catch(() => {
          throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
        });
        return sendMotionFile(request, reply, media, false);
      },
    });
  }
}
