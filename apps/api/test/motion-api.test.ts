import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clipEnergySchema,
  errorResponseSchema,
  motionStudySchema,
  referenceResponseSchema,
  statsResponseSchema,
  type ClipEvidence,
} from "@retr0vault/shared";

import { createDatabaseConnection } from "../src/database/connection.js";
import { probeMedia, resolveMotionTools } from "../src/motion/ffmpeg.js";
import type { ClipProcessor } from "../src/motion/queue.js";
import { maintainOrphanFiles } from "../src/storage/orphans.js";
import { createMultipartPayload, createTestApp, disposeTestApp, type TestAppContext } from "./helpers.js";

const tools = resolveMotionTools();
if (tools === undefined) throw new Error("The bundled ffmpeg/ffprobe must be installed to run motion tests");

let fixtures: string;
const clip = (name: string) => readFileSync(join(fixtures, name));

beforeAll(() => {
  fixtures = mkdtempSync(join(tmpdir(), "retr0vault-motion-fixtures-"));
  const ffmpeg = (args: string[]) => execFileSync(tools.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  // Static grey, a moving test pattern, then a hard cut to blue.
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x808080:s=320x200:d=1:r=30", "-f", "lavfi", "-i", "testsrc2=s=320x200:d=1:r=30",
    "-f", "lavfi", "-i", "color=c=0x2040c0:s=320x200:d=0.5:r=30",
    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0,format=yuv420p", "-c:v", "libx264", join(fixtures, "moving.mp4")]);
  // A non-H.264 source that must be transcoded.
  ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=320x200:d=1.5:r=25", "-c:v", "mpeg4", join(fixtures, "legacy.avi")]);
  // Longer than the 60 s limit, but tiny.
  ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=64x64:d=61:r=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(fixtures, "long.mp4")]);
}, 60_000);

afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

async function createReference(context: TestAppContext): Promise<string> {
  const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: "white" } }).png().toBuffer();
  const multipart = createMultipartPayload({ fields: { title: "Motion reference" }, file: { buffer: image } });
  const response = await context.app.inject({ method: "POST", url: "/api/v1/references/image", ...multipart });
  expect(response.statusCode, response.body).toBe(201);
  return referenceResponseSchema.parse(response.json()).id;
}

async function uploadClip(context: TestAppContext, referenceId: string, buffer: Buffer, fields: Record<string, string> = {}) {
  const multipart = createMultipartPayload({ fields, file: { buffer, filename: "recording.mp4", contentType: "video/mp4" } });
  return context.app.inject({ method: "POST", url: `/api/v1/references/${referenceId}/motion/clips`, ...multipart });
}

async function getStudy(context: TestAppContext, referenceId: string) {
  const response = await context.app.inject({ method: "GET", url: `/api/v1/references/${referenceId}/motion` });
  expect(response.statusCode, response.body).toBe(200);
  return motionStudySchema.parse(response.json());
}

function expectError(response: Awaited<ReturnType<TestAppContext["app"]["inject"]>>, status: number, code: string) {
  expect(response.statusCode, response.body).toBe(status);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe(code);
}

const fakeEvidence: ClipEvidence = {
  sampleFps: 10, sampleCount: 2, gridColumns: 8, gridRows: 6, threshold: 0.012, meanEnergy: 0,
  events: [], cutsMs: [], bursts: [], regionTotals: new Array(48).fill(0),
};
const instantProcessor: ClipProcessor = async () => ({
  sourceFormat: "mov/h264", durationMs: 2_500, width: 320, height: 200, fps: 30, bytes: 1, evidence: fakeEvidence, keyframes: [],
});

describe("motion studies with the bundled ffmpeg", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  it("processes a recording into playable media and evidence", async () => {
    context = await createTestApp("motion-pipeline");
    const referenceId = await createReference(context);

    const accepted = await uploadClip(context, referenceId, clip("moving.mp4"), { label: "Hero cursor", posterMs: "1500" });
    expect(accepted.statusCode, accepted.body).toBe(202);
    const queued = motionStudySchema.parse(accepted.json());
    expect(queued.clips).toHaveLength(1);
    expect(["queued", "processing"]).toContain(queued.clips[0]!.processingStatus);
    expect(queued.clips[0]!.label).toBe("Hero cursor");

    await context.app.motionQueue.idle();
    const study = await getStudy(context, referenceId);
    const ready = study.clips[0]!;
    expect(ready.processingStatus, ready.processingError ?? "").toBe("ready");
    expect(ready.durationMs).toBeGreaterThan(2_300);
    expect(ready.durationMs).toBeLessThan(2_700);
    expect([ready.width, ready.height]).toEqual([320, 200]);
    expect(ready.sourceFormat).toBe("mov/h264");
    expect(ready.posterMs).toBe(1_500);
    expect(ready.evidence!.events.length).toBeGreaterThanOrEqual(1);
    expect(ready.evidence!.cutsMs.length).toBeGreaterThanOrEqual(1);
    expect(ready.evidence!.bursts.length).toBeGreaterThanOrEqual(1);
    expect(ready.keyframes[0]).toMatchObject({ index: 0, timeMs: 0, reason: "start" });
    expect(ready.keyframes.at(-1)!.reason).toBe("end");
    expect(ready.keyframes.map((keyframe) => keyframe.reason)).toContain("cut");

    const clipDirectory = join(context.storageRoot, "motion", referenceId, ready.id);
    const files = readdirSync(clipDirectory).sort();
    expect(files).not.toContain("source.bin");
    expect(files).toEqual(expect.arrayContaining(["clip.mp4", "preview.mp4", "poster.webp", "energy.json", "energy.webp",
      "regions.webp", "contact-sheet.webp", "burst-0.webp", "k-000.webp"]));
    expect((await probeMedia(tools, join(clipDirectory, "preview.mp4"))).width).toBe(320);

    const media = (path: string, headers: Record<string, string> = {}) =>
      context.app.inject({ method: "GET", url: `/api/v1/media/motion/${ready.id}/${path}`, headers });
    for (const path of ["poster", "energy", "regions", "contact-sheet", "keyframes/0", "bursts/0"]) {
      const response = await media(path);
      expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
      expect(response.headers["content-type"]).toBe("image/webp");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["accept-ranges"]).toBeUndefined();
    }
    const missingKeyframe = await media(`keyframes/${ready.keyframes.length}`);
    expectError(missingKeyframe, 404, "MEDIA_NOT_FOUND");
    expect(missingKeyframe.headers["cache-control"]).toBe("no-store");

    const energy = clipEnergySchema.parse((await context.app.inject({ method: "GET", url: `/api/v1/motion/clips/${ready.id}/energy` })).json());
    expect(energy.energy.length).toBe(ready.evidence!.sampleCount);

    // Byte ranges, which browsers need to seek.
    const bytes = readFileSync(join(clipDirectory, "clip.mp4"));
    const full = await media("clip");
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toBe("video/mp4");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.rawPayload.equals(bytes)).toBe(true);
    const first = await media("clip", { range: "bytes=0-99" });
    expect(first.statusCode).toBe(206);
    expect(first.headers["content-range"]).toBe(`bytes 0-99/${bytes.length}`);
    expect(first.rawPayload.equals(bytes.subarray(0, 100))).toBe(true);
    const tail = await media("clip", { range: "bytes=-10" });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.equals(bytes.subarray(bytes.length - 10))).toBe(true);
    const open = await media("clip", { range: `bytes=${bytes.length - 5}-` });
    expect(open.rawPayload.length).toBe(5);
    const unsatisfiable = await media("clip", { range: `bytes=${bytes.length}-` });
    expect(unsatisfiable.statusCode).toBe(416);
    expect(unsatisfiable.headers["content-range"]).toBe(`bytes */${bytes.length}`);
    const head = await context.app.inject({ method: "HEAD", url: `/api/v1/media/motion/${ready.id}/preview`, headers: { range: "bytes=0-9" } });
    expect(head.statusCode).toBe(206);
    expect(head.headers["content-length"]).toBe("10");
    expect(head.rawPayload.length).toBe(0);
    const cached = await media("clip", { "if-none-match": String(full.headers.etag) });
    expect(cached.statusCode).toBe(304);

    // The catalogue sees the study through the additive reference summary and stats.
    const reference = referenceResponseSchema.parse((await context.app.inject({ method: "GET", url: `/api/v1/references/${referenceId}` })).json());
    expect(reference.motion).toMatchObject({ studyId: study.id, status: "pending", clipCount: 1, readyClipCount: 1, primaryClipId: ready.id });
    const stats = statsResponseSchema.parse((await context.app.inject({ method: "GET", url: "/api/v1/stats" })).json());
    expect(stats.motionStudies).toEqual({ total: 1, pending: 1, analyzed: 0, manual: 0, failed: 0 });
  }, 60_000);

  it("transcodes a non-H.264 recording into an H.264 MP4", async () => {
    context = await createTestApp("motion-transcode");
    const referenceId = await createReference(context);
    expect((await uploadClip(context, referenceId, clip("legacy.avi"))).statusCode).toBe(202);
    await context.app.motionQueue.idle();
    const [ready] = (await getStudy(context, referenceId)).clips;
    expect(ready!.processingStatus, ready!.processingError ?? "").toBe("ready");
    expect(ready!.sourceFormat).toBe("avi/mpeg4");
    expect(ready!.label).toBe("Primary");
    const normalized = await probeMedia(tools, join(context.storageRoot, "motion", referenceId, ready!.id, "clip.mp4"));
    expect(normalized.codec).toBe("h264");
    expect(normalized.pixelFormat).toBe("yuv420p");
  }, 60_000);

  it("rejects files that are not usable recordings and leaves nothing behind", async () => {
    context = await createTestApp("motion-reject");
    const referenceId = await createReference(context);

    expectError(await uploadClip(context, referenceId, Buffer.from("not a video at all")), 415, "UNSUPPORTED_MEDIA");
    expectError(await uploadClip(context, referenceId, clip("long.mp4")), 422, "MOTION_OUT_OF_LIMITS");
    expectError(await uploadClip(context, referenceId, clip("moving.mp4"), { label: "x".repeat(61) }), 400, "VALIDATION_ERROR");
    expectError(await uploadClip(context, referenceId, clip("moving.mp4"), { unexpected: "1" }), 400, "VALIDATION_ERROR");
    expectError(await uploadClip(context, "00000000-0000-4000-8000-000000000000", clip("moving.mp4")), 404, "REFERENCE_NOT_FOUND");
    const noFile = createMultipartPayload({ fields: { label: "Empty" } });
    expectError(await context.app.inject({ method: "POST", url: `/api/v1/references/${referenceId}/motion/clips`, ...noFile }), 400, "RECORDING_REQUIRED");
    expectError(await context.app.inject({ method: "POST", url: `/api/v1/references/${referenceId}/motion/clips`, payload: {} }), 415, "MULTIPART_REQUIRED");

    expectError(await context.app.inject({ method: "GET", url: `/api/v1/references/${referenceId}/motion` }), 404, "MOTION_STUDY_NOT_FOUND");
    const motionRoot = join(context.storageRoot, "motion", referenceId);
    expect(existsSync(motionRoot) ? readdirSync(motionRoot) : []).toEqual([]);
  }, 60_000);

  it("enforces the upload size limit", async () => {
    context = await createTestApp("motion-size", { maxMotionUploadBytes: 1_024 * 1_024 });
    const referenceId = await createReference(context);
    expectError(await uploadClip(context, referenceId, Buffer.alloc(1_024 * 1_024 + 10, 1)), 413, "UPLOAD_TOO_LARGE");
  });

  it("answers 503 when ffmpeg is unavailable, without touching other features", async () => {
    context = await createTestApp("motion-no-tools", { motionTools: null });
    const referenceId = await createReference(context);
    expectError(await uploadClip(context, referenceId, clip("moving.mp4")), 503, "MOTION_TOOLS_UNAVAILABLE");
    expect((await context.app.inject({ method: "GET", url: "/api/v1/health" })).statusCode).toBe(200);
  });
});

describe("motion clip management", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  it("keeps at most four clips, reorders and compacts them", async () => {
    context = await createTestApp("motion-manage", { motionProcessor: instantProcessor });
    const referenceId = await createReference(context);
    for (let index = 0; index < 4; index += 1) {
      expect((await uploadClip(context, referenceId, clip("moving.mp4"))).statusCode).toBe(202);
    }
    expectError(await uploadClip(context, referenceId, clip("moving.mp4")), 409, "MOTION_CLIP_LIMIT");
    await context.app.motionQueue.idle();
    let study = await getStudy(context, referenceId);
    expect(study.clips.map((entry) => entry.label)).toEqual(["Primary", "Clip 2", "Clip 3", "Clip 4"]);
    expect(study.clips.every((entry) => entry.processingStatus === "ready")).toBe(true);

    const last = study.clips[3]!;
    const moved = await context.app.inject({ method: "PATCH", url: `/api/v1/motion/clips/${last.id}`, payload: { sortOrder: 0, label: "Scroll journey" } });
    expect(moved.statusCode, moved.body).toBe(200);
    study = motionStudySchema.parse(moved.json());
    expect(study.clips.map((entry) => entry.label)).toEqual(["Scroll journey", "Primary", "Clip 2", "Clip 3"]);
    expect(study.clips.map((entry) => entry.sortOrder)).toEqual([0, 1, 2, 3]);

    expect((await context.app.inject({ method: "DELETE", url: `/api/v1/motion/clips/${study.clips[1]!.id}` })).statusCode).toBe(204);
    study = await getStudy(context, referenceId);
    expect(study.clips.map((entry) => [entry.label, entry.sortOrder])).toEqual([["Scroll journey", 0], ["Clip 2", 1], ["Clip 3", 2]]);

    expectError(await context.app.inject({ method: "POST", url: `/api/v1/motion/clips/${study.clips[0]!.id}/retry`, payload: {} }), 409, "MOTION_CLIP_NOT_FAILED");
    expectError(await context.app.inject({ method: "PATCH", url: `/api/v1/motion/clips/${study.clips[0]!.id}`, payload: { sortOrder: 9 } }), 400, "VALIDATION_ERROR");
    expectError(await context.app.inject({ method: "DELETE", url: "/api/v1/motion/clips/00000000-0000-4000-8000-000000000000" }), 404, "MOTION_CLIP_NOT_FOUND");
  });

  it("records a safe failure message and retries a failed clip", async () => {
    let fail = true;
    context = await createTestApp("motion-retry", {
      motionProcessor: async (input) => {
        if (fail) throw new Error(`ffmpeg exploded at ${input.clipId}`);
        return instantProcessor(input);
      },
    });
    const referenceId = await createReference(context);
    await uploadClip(context, referenceId, clip("moving.mp4"));
    await context.app.motionQueue.idle();
    const [failed] = (await getStudy(context, referenceId)).clips;
    expect(failed!.processingStatus).toBe("failed");
    expect(failed!.processingError).toBe("The recording could not be processed");
    expect(existsSync(join(context.storageRoot, "motion", referenceId, failed!.id, "source.bin"))).toBe(true);

    // Without the original upload there is nothing to retry from.
    const source = join(context.storageRoot, "motion", referenceId, failed!.id, "source.bin");
    renameSync(source, `${source}.away`);
    expectError(await context.app.inject({ method: "POST", url: `/api/v1/motion/clips/${failed!.id}/retry`, payload: {} }), 409, "MOTION_SOURCE_MISSING");
    renameSync(`${source}.away`, source);

    fail = false;
    const retried = await context.app.inject({ method: "POST", url: `/api/v1/motion/clips/${failed!.id}/retry`, payload: {} });
    expect(retried.statusCode, retried.body).toBe(202);
    await context.app.motionQueue.idle();
    expect((await getStudy(context, referenceId)).clips[0]!.processingStatus).toBe("ready");
    expectError(await context.app.inject({ method: "POST", url: `/api/v1/motion/clips/${failed!.id}/retry`, payload: {} }), 409, "MOTION_CLIP_NOT_FAILED");
  });

  it("deletes a study without the reference, and a reference with its study", async () => {
    context = await createTestApp("motion-delete", { motionProcessor: instantProcessor });
    const first = await createReference(context);
    const second = await createReference(context);
    await uploadClip(context, first, clip("moving.mp4"));
    await uploadClip(context, second, clip("moving.mp4"));
    await context.app.motionQueue.idle();

    expect((await context.app.inject({ method: "DELETE", url: `/api/v1/references/${first}/motion` })).statusCode).toBe(204);
    expect((await context.app.inject({ method: "GET", url: `/api/v1/references/${first}` })).statusCode).toBe(200);
    expect(existsSync(join(context.storageRoot, "motion", first))).toBe(false);

    expect((await context.app.inject({ method: "DELETE", url: `/api/v1/references/${second}` })).statusCode).toBe(204);
    expect(existsSync(join(context.storageRoot, "motion", second))).toBe(false);
    const connection = createDatabaseConnection(context.databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM motion_clips").get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("resumes clips interrupted by a shutdown", async () => {
    const hanging: ClipProcessor = (input) => new Promise((_, reject) => {
      input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    context = await createTestApp("motion-recover", { motionProcessor: hanging });
    const referenceId = await createReference(context);
    await uploadClip(context, referenceId, clip("moving.mp4"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await getStudy(context, referenceId)).clips[0]!.processingStatus).toBe("processing");
    const directory = context.directory;
    await context.app.close();

    context = await createTestApp("motion-recover", { directory, motionProcessor: instantProcessor });
    await context.app.ready();
    await context.app.motionQueue.idle();
    expect((await getStudy(context, referenceId)).clips[0]!.processingStatus).toBe("ready");
  });

  it("reports orphaned motion files but never a live clip's", async () => {
    context = await createTestApp("motion-orphans", {
      motionProcessor: async (input) => {
        await input.storage.writeFile(input.referenceId, input.clipId, "poster.webp", Buffer.from("poster"));
        return instantProcessor(input);
      },
    });
    const referenceId = await createReference(context);
    await uploadClip(context, referenceId, clip("moving.mp4"));
    await context.app.motionQueue.idle();
    const [live] = (await getStudy(context, referenceId)).clips;
    const stray = join(context.storageRoot, "motion", referenceId, "00000000-0000-4000-8000-00000000abcd");
    mkdirSync(stray, { recursive: true });
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000);
    for (const name of ["clip.mp4", "notes.txt"]) {
      writeFileSync(join(stray, name), "x");
      utimesSync(join(stray, name), old, old);
    }
    utimesSync(join(context.storageRoot, "motion", referenceId, live!.id, "poster.webp"), old, old);

    const connection = createDatabaseConnection(context.databasePath);
    try {
      const report = maintainOrphanFiles(connection, context.storageRoot);
      expect(report.candidates).toEqual([`motion/${referenceId}/00000000-0000-4000-8000-00000000abcd/clip.mp4`]);
      expect(report.skipped).toEqual(expect.arrayContaining([
        { path: `motion/${referenceId}/00000000-0000-4000-8000-00000000abcd/notes.txt`, reason: "unrecognized filename" },
        { path: `motion/${referenceId}/${live!.id}/poster.webp`, reason: "owned by a database reference" },
      ]));
    } finally {
      connection.sqlite.close();
    }
  });
});
