import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorResponseSchema, referenceResponseSchema } from "@retr0vault/shared";

import type { CapturedFrame } from "../src/capture/service.js";
import { ReferenceStorage } from "../src/storage/reference-storage.js";
import { createMultipartPayload, createTestApp, disposeTestApp, type TestAppContext } from "./helpers.js";

const plate = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } });

describe("replacing a reference's picture", () => {
  let context: TestAppContext;
  let red: Buffer;
  let blue: Buffer;
  let frames: CapturedFrame[];

  beforeEach(async () => {
    red = await plate(96, 64, "red").png().toBuffer();
    blue = await plate(96, 64, "blue").png().toBuffer();
    frames = [
      { name: "viewport", frameType: "viewport", buffer: red },
      { name: "hero", frameType: "hero", buffer: blue },
      { name: "scroll-50", frameType: "scroll", buffer: blue },
      { name: "scroll-80", frameType: "scroll", buffer: blue },
    ];
    context = await createTestApp("reference-image", {
      captureService: { capture: async () => ({ frames }), close: async () => undefined },
    });
  });

  afterEach(async () => {
    await disposeTestApp(context);
  });

  async function fileImage() {
    const multipart = createMultipartPayload({ fields: { title: "Plate" }, file: { buffer: red } });
    const response = await context.app.inject({ method: "POST", url: "/api/v1/references/image", ...multipart });
    expect(response.statusCode, response.body).toBe(201);
    return referenceResponseSchema.parse(response.json());
  }

  async function fileWebsite() {
    const response = await context.app.inject({ method: "POST", url: "/api/v1/references/url", payload: { url: "https://example.com/" } });
    expect(response.statusCode, response.body).toBe(201);
    return referenceResponseSchema.parse(response.json());
  }

  function replace(id: string, buffer: Buffer, fields: Record<string, string> = {}) {
    const multipart = createMultipartPayload({ fields, file: { buffer, filename: "replacement" } });
    return context.app.inject({ method: "PUT", url: `/api/v1/references/${id}/image`, ...multipart });
  }

  function leftovers(): string[] {
    const found: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(directory, entry.name));
        else if (/\.(incoming|previous)$/u.test(entry.name)) found.push(entry.name);
      }
    };
    walk(context.storageRoot);
    return found;
  }

  async function thumbnailColour(id: string) {
    const response = await context.app.inject({ url: `/api/v1/media/${id}/thumbnail?v=${Date.now()}` });
    expect(response.statusCode).toBe(200);
    const { dominant } = await sharp(response.rawPayload).stats();
    return dominant;
  }

  it("swaps an image reference's original and thumbnail, following the new format", async () => {
    const reference = await fileImage();
    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${reference.id}`, payload: { designThesis: "Kept", analysisStatus: "analyzed" } });
    const before = await context.app.inject({ url: `/api/v1/media/${reference.id}/original` });
    const jpeg = await plate(40, 30, "green").jpeg().toBuffer();

    const response = await replace(reference.id, jpeg);
    expect(response.statusCode, response.body).toBe(200);
    const replaced = referenceResponseSchema.parse(response.json());
    expect(replaced).toMatchObject({
      id: reference.id,
      title: "Plate",
      designThesis: "Kept",
      analysisStatus: "analyzed",
      originalPath: `originals/${reference.id}.jpg`,
      thumbnailPath: reference.thumbnailPath,
      image: { width: 40, height: 30, format: "jpeg" },
    });

    // The uploaded bytes are kept exactly; the old original is gone, not orphaned.
    expect(readFileSync(join(context.storageRoot, replaced.originalPath))).toEqual(jpeg);
    expect(existsSync(join(context.storageRoot, reference.originalPath))).toBe(false);
    expect(leftovers()).toEqual([]);

    const after = await context.app.inject({ url: `/api/v1/media/${reference.id}/original` });
    expect(after.headers["content-type"]).toBe("image/jpeg");
    expect(after.headers.etag).not.toBe(before.headers.etag);
    // A cached copy of the old picture is not revalidated as current.
    const revalidated = await context.app.inject({ url: `/api/v1/media/${reference.id}/original`, headers: { "if-none-match": String(before.headers.etag) } });
    expect(revalidated.statusCode).toBe(200);
    const dominant = await thumbnailColour(reference.id);
    expect(dominant.g).toBeGreaterThan(dominant.r);
  });

  it("files the reference back for analysis only when asked", async () => {
    const reference = await fileImage();
    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${reference.id}`, payload: { analysisStatus: "analyzed" } });

    const kept = await replace(reference.id, blue, { resetAnalysis: "false" });
    expect(referenceResponseSchema.parse(kept.json()).analysisStatus).toBe("analyzed");

    const reset = await replace(reference.id, red, { resetAnalysis: "true" });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(referenceResponseSchema.parse(reset.json())).toMatchObject({ analysisStatus: "pending", image: { format: "png" } });
    expect(leftovers()).toEqual([]);
  });

  it("makes a new picture a website reference's viewport frame, stored as PNG, and keeps its other frames", async () => {
    const reference = await fileWebsite();
    const hero = reference.frames.find((frame) => frame.frameType === "hero")!;
    const webp = await plate(120, 80, "green").webp().toBuffer();

    const response = await replace(reference.id, webp);
    expect(response.statusCode, response.body).toBe(200);
    const replaced = referenceResponseSchema.parse(response.json());
    expect(replaced).toMatchObject({
      sourceType: "website",
      sourceUrl: "https://example.com/",
      originalPath: `captures/${reference.id}/viewport.png`,
      image: { width: 120, height: 80, format: "png" },
    });
    expect(replaced.frames).toEqual(reference.frames);

    const stored = await sharp(readFileSync(join(context.storageRoot, replaced.originalPath))).metadata();
    expect(stored).toMatchObject({ format: "png", width: 120, height: 80 });
    expect(readFileSync(join(context.storageRoot, hero.imagePath))).toEqual(blue);
    expect(leftovers()).toEqual([]);
    const dominant = await thumbnailColour(reference.id);
    expect(dominant.g).toBeGreaterThan(dominant.r);
  });

  it("refuses what it cannot use and leaves the old picture in place", async () => {
    const reference = await fileImage();

    const broken = await replace(reference.id, Buffer.from("not an image"));
    expect(broken.statusCode).toBe(400);
    expect(errorResponseSchema.parse(broken.json()).error.code).toBe("INVALID_IMAGE");

    const gif = await plate(8, 8, "green").gif().toBuffer();
    expect((await replace(reference.id, gif)).statusCode).toBe(415);

    const truncated = (await plate(64, 64, "green").png().toBuffer()).subarray(0, 120);
    expect((await replace(reference.id, truncated)).statusCode).toBe(400);

    const badField = await replace(reference.id, blue, { resetAnalysis: "yes" });
    expect(badField.statusCode).toBe(400);
    const unknownField = await replace(reference.id, blue, { title: "Renamed" });
    expect(unknownField.statusCode).toBe(400);

    const missing = await replace("00000000-0000-4000-8000-000000000000", blue);
    expect(missing.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missing.json()).error.code).toBe("REFERENCE_NOT_FOUND");

    const current = referenceResponseSchema.parse((await context.app.inject({ url: `/api/v1/references/${reference.id}` })).json());
    expect(current).toMatchObject({ originalPath: reference.originalPath, image: reference.image });
    expect(readFileSync(join(context.storageRoot, reference.originalPath))).toEqual(red);
    expect(leftovers()).toEqual([]);
    const dominant = await thumbnailColour(reference.id);
    expect(dominant.r).toBeGreaterThan(dominant.g);
  });

  it("needs exactly one image in the file field", async () => {
    const reference = await fileImage();
    const noFile = createMultipartPayload({ fields: { resetAnalysis: "true" } });
    const response = await context.app.inject({ method: "PUT", url: `/api/v1/references/${reference.id}/image`, ...noFile });
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("IMAGE_FILE_REQUIRED");
    const json = await context.app.inject({ method: "PUT", url: `/api/v1/references/${reference.id}/image`, payload: {} });
    expect(json.statusCode).toBe(415);
  });

  it("puts the previous files back when the swap is rolled back, and swaps one at a time", async () => {
    const reference = await fileImage();
    const storage = new ReferenceStorage(context.storageRoot);
    const current = { sourceType: "image" as const, originalPath: reference.originalPath, thumbnailPath: reference.thumbnailPath };
    const thumbnail = readFileSync(join(context.storageRoot, reference.thumbnailPath));

    const staged = await storage.replaceImage(reference.id, current, await plate(40, 30, "green").jpeg().toBuffer());
    expect(existsSync(join(context.storageRoot, staged.image.originalPath))).toBe(true);
    await expect(storage.replaceImage(reference.id, current, blue)).rejects.toMatchObject({ statusCode: 409, code: "REFERENCE_IMAGE_BUSY" });

    expect((await staged.rollback()).warnings).toEqual([]);
    expect(existsSync(join(context.storageRoot, staged.image.originalPath))).toBe(false);
    expect(readFileSync(join(context.storageRoot, reference.originalPath))).toEqual(red);
    expect(readFileSync(join(context.storageRoot, reference.thumbnailPath))).toEqual(thumbnail);
    expect(leftovers()).toEqual([]);

    // Released: the next swap goes ahead.
    const next = await storage.replaceImage(reference.id, current, blue);
    expect((await next.commit()).warnings).toEqual([]);
    expect(readFileSync(join(context.storageRoot, reference.originalPath))).toEqual(blue);
    expect(leftovers()).toEqual([]);
  });

  it("replaces a picture whose files had already gone missing", async () => {
    const reference = await fileImage();
    const storage = new ReferenceStorage(context.storageRoot);
    await storage.deleteReferenceFiles(reference.id, reference.originalPath, reference.thumbnailPath);
    expect((await context.app.inject({ url: `/api/v1/media/${reference.id}/thumbnail` })).statusCode).toBe(404);

    const response = await replace(reference.id, blue);
    expect(response.statusCode, response.body).toBe(200);
    expect((await context.app.inject({ url: `/api/v1/media/${reference.id}/thumbnail` })).statusCode).toBe(200);
  });
});
