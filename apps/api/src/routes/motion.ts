import { randomUUID } from "node:crypto";
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

import type { Db } from "../database/connection.js";
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
import { BlobRangeError, resolveRange, type ByteRange, type RangeRequest } from "../storage/blob-store.js";
import type { MotionMediaKind, MotionStorage, OpenMotionFile } from "../storage/motion-storage.js";
import { assertOwnedClip, assertOwnedReference } from "../services/ownership.js";
import { requireUser } from "./auth.js";

const referenceParameters = z.object({ id: z.uuid() }).strict();
const clipParameters = z.object({ clipId: z.uuid().toLowerCase() }).strict();
const emptyQuery = z.object({}).strict();

export interface MotionRouteOptions {
  readonly db: Db;
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
 * One `bytes=` range, as browsers send for video seeking, before the file's
 * size is known. Multiple ranges are answered with the whole file (allowed by
 * RFC 9110); a malformed header is ignored.
 */
export function parseRangeHeader(header: string | undefined): RangeRequest | "unsatisfiable" | undefined {
  if (header === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return undefined;
  if (first === "") {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return "unsatisfiable";
    return { suffix };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start)) return "unsatisfiable";
  const end = Number(last);
  // An end past any possible size means "to the end".
  return { start, end: last === "" || !Number.isSafeInteger(end) ? undefined : end };
}

/** The bytes a `Range` header covers in a file of `size` bytes. */
export function parseByteRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | undefined {
  const requested = parseRangeHeader(header);
  return requested === undefined || requested === "unsatisfiable" ? requested : resolveRange(requested, size);
}

async function sendMotionFile(
  request: FastifyRequest,
  reply: FastifyReply,
  open: (range?: RangeRequest) => Promise<OpenMotionFile>,
  ranges: boolean,
): Promise<FastifyReply> {
  reply.header("Cache-Control", "private, max-age=0, must-revalidate").header("X-Content-Type-Options", "nosniff");
  if (ranges) reply.header("Accept-Ranges", "bytes");
  const requested = ranges ? parseRangeHeader(request.headers.range) : undefined;
  let media: OpenMotionFile;
  try {
    // The range goes to the store with the read: one request per seek.
    media = await open(requested === "unsatisfiable" ? undefined : requested);
  } catch (error) {
    if (error instanceof BlobRangeError) {
      return reply.code(416).header("Content-Range", `bytes */${error.size}`).send();
    }
    // Missing, unreadable and unsafe files are indistinguishable over HTTP.
    throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
  }
  try {
    reply.header("ETag", media.etag);
    if (matchesEtag(request.headers["if-none-match"], media.etag)) {
      media.body.destroy();
      return reply.code(304).send();
    }
    reply.type(media.contentType);
    if (requested === "unsatisfiable") {
      media.body.destroy();
      return reply.code(416).header("Content-Range", `bytes */${media.size}`).send();
    }
    if (media.range !== undefined) {
      reply.code(206).header("Content-Range", `bytes ${media.range.start}-${media.range.end}/${media.size}`)
        .header("Content-Length", media.range.end - media.range.start + 1);
    } else {
      reply.header("Content-Length", media.size);
    }
    if (request.method === "HEAD") {
      media.body.destroy();
      return reply.send();
    }
    return await reply.send(media.body);
  } catch (error) {
    media.body.destroy();
    throw error;
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
  const { db, storage, queue } = options;

  app.post("/api/v1/references/:id/motion/clips", async (request, reply) => {
    const { id: referenceId } = parseRequest(referenceParameters, request.params);
    await assertOwnedReference(db, referenceId, requireUser(request).id);
    parseRequest(emptyQuery, request.query);
    if (!request.isMultipart()) throw new ApiError(415, "MULTIPART_REQUIRED", "Recordings must be uploaded as multipart/form-data");
    if (options.tools === undefined || !queue.available) throw motionToolsUnavailable();
    await assertClipCapacity(db, referenceId);

    const clipId = randomUUID();
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let upload: string | undefined;
    // The recording is checked on this PC before it is stored.
    const workspace = await storage.createWorkspace();
    try {
      for await (const part of request.parts({ limits: { fileSize: options.maxUploadBytes, files: 1, fields: 4 } })) {
        if (part.type === "file") {
          if (part.fieldname !== "file" || upload !== undefined) {
            part.file.resume();
            throw new ApiError(400, "VALIDATION_ERROR", "Upload exactly one recording in the multipart field 'file'");
          }
          upload = await storage.receiveUpload(workspace, part.file);
          if (part.file.truncated) throw new ApiError(413, "UPLOAD_TOO_LARGE", "The recording exceeds the configured size limit");
        } else {
          if (part.valueTruncated || part.fieldnameTruncated) throw new ApiError(413, "MULTIPART_FIELD_TOO_LARGE", "An upload field exceeds the size limit");
          if (Object.hasOwn(fields, part.fieldname)) throw new ApiError(400, "DUPLICATE_MULTIPART_FIELD", "A multipart field was provided more than once");
          fields[part.fieldname] = part.value;
        }
      }
      if (upload === undefined) throw new ApiError(400, "RECORDING_REQUIRED", "Upload exactly one recording in the multipart field 'file'");
      const input = parseRequest(createMotionClipFieldsSchema, fields);
      let probe;
      try {
        probe = await probeMedia(options.tools, upload);
        assertWithinLimits(probe);
      } catch (error) {
        if (error instanceof MotionLimitError) throw new ApiError(422, "MOTION_OUT_OF_LIMITS", error.message);
        if (error instanceof UnsupportedMediaError) throw new ApiError(415, "UNSUPPORTED_MEDIA", error.message);
        throw error;
      }
      await storage.storeFile(referenceId, clipId, "source.bin", upload);
      const study = await createQueuedClip(db, {
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
    } finally {
      await workspace.dispose();
    }
  });

  app.get("/api/v1/references/:id/motion", async (request) => {
    const { id } = parseRequest(referenceParameters, request.params);
    await assertOwnedReference(db, id, requireUser(request).id);
    parseRequest(emptyQuery, request.query);
    return await getMotionStudy(db, id);
  });

  app.delete("/api/v1/references/:id/motion", async (request, reply) => {
    const { id } = parseRequest(referenceParameters, request.params);
    await assertOwnedReference(db, id, requireUser(request).id);
    await deleteStudyRecord(db, id);
    const warnings = await storage.removeStudy(id);
    if (warnings.length > 0) request.log.warn({ referenceId: id, warnings }, "Motion study deleted with file cleanup warnings");
    return reply.status(204).send();
  });

  app.patch("/api/v1/references/:id/motion", async (request) => {
    const { id } = parseRequest(referenceParameters, request.params);
    const input = parseRequest(updateMotionStudySchema, request.body);
    await assertOwnedReference(db, id, requireUser(request).id);
    return await updateMotionStudy(db, id, input);
  });

  app.get("/api/v1/motion", async (request) => {
    const query = parseRequest(motionListQuerySchema, request.query);
    return await listMotion(db, query, requireUser(request).id);
  });

  app.get("/api/v1/motion/pending", async (request) => {
    parseRequest(emptyQuery, request.query);
    return await getPendingMotion(db, storage, options.dataDirectory, requireUser(request).id);
  });

  app.post("/api/v1/motion/import", { bodyLimit: 2 * 1_024 * 1_024 }, async (request) => {
    const input = parseRequest(motionImportRequestSchema, request.body);
    return await importMotionAnalyses(db, input.analyses.map((value, index) => ({ source: String(index), value })),
      input.overwriteProtected, undefined, requireUser(request).id);
  });

  app.post("/api/v1/motion/:referenceId/reset", async (request) => {
    const { referenceId } = parseRequest(z.object({ referenceId: z.uuid() }).strict(), request.params);
    await assertOwnedReference(db, referenceId, requireUser(request).id);
    parseRequest(emptyQuery, request.body ?? {});
    return await resetMotionAnalysis(db, referenceId);
  });

  app.patch("/api/v1/motion/clips/:clipId", async (request) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    await assertOwnedClip(db, clipId, requireUser(request).id);
    const input = parseRequest(updateMotionClipSchema, request.body);
    return await updateClip(db, clipId, input);
  });

  app.delete("/api/v1/motion/clips/:clipId", async (request, reply) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    await assertOwnedClip(db, clipId, requireUser(request).id);
    const removed = await deleteClipRecord(db, clipId);
    const warnings = await storage.removeClip(removed.referenceId, removed.clipId);
    if (warnings.length > 0) request.log.warn({ clipId, warnings }, "Motion clip deleted with file cleanup warnings");
    return reply.status(204).send();
  });

  app.post("/api/v1/motion/clips/:clipId/retry", async (request, reply) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    await assertOwnedClip(db, clipId, requireUser(request).id);
    parseRequest(emptyQuery, request.body ?? {});
    if (options.tools === undefined || !queue.available) throw motionToolsUnavailable();
    const { clip, study } = await findClipContext(db, clipId);
    if (clip.processingStatus !== "failed") throw new ApiError(409, "MOTION_CLIP_NOT_FAILED", "Only a failed clip can be retried");
    if (!await storage.exists(study.referenceId, clipId, "source.bin")) {
      throw new ApiError(409, "MOTION_SOURCE_MISSING", "The original upload is gone; remove this clip and upload it again");
    }
    await requeueClip(db, clipId);
    queue.enqueue(clipId);
    return reply.status(202).send(await getMotionStudy(db, study.referenceId));
  });

  app.get("/api/v1/motion/clips/:clipId/energy", async (request) => {
    const { clipId } = parseRequest(clipParameters, request.params);
    await assertOwnedClip(db, clipId, requireUser(request).id);
    parseRequest(emptyQuery, request.query);
    const { referenceId } = await readyClipForMedia(db, clipId);
    const text = await storage.readText(referenceId, clipId, "energy.json").catch(() => {
      throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
    });
    const parsed = z.object({ sampleFps: z.number(), energy: z.array(z.number()) }).passthrough()
      .parse(JSON.parse(text));
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
        await assertOwnedClip(db, clipId, requireUser(request).id);
        parseRequest(emptyQuery, request.query);
        const { referenceId } = await readyClipForMedia(db, clipId);
        return sendMotionFile(request, reply, (range) => storage.openMedia(referenceId, clipId, kind, range),
          kind === "clip" || kind === "preview");
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
        await assertOwnedClip(db, clipId, requireUser(request).id);
        const clip = await readyClipForMedia(db, clipId);
        if (index >= (kind === "keyframes" ? clip.keyframeCount : clip.burstCount)) {
          throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
        }
        return sendMotionFile(request, reply,
          () => storage.openIndexed(clip.referenceId, clipId, kind === "keyframes" ? "keyframe" : "burst", index), false);
      },
    });
  }
}
