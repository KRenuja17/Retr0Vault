import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pendingAnalysisManifestSchema, referenceListResponseSchema, referenceResponseSchema } from "@retr0vault/shared";

import type { CapturedFrame, CaptureService } from "../src/capture/service.js";
import { createDatabaseConnection, type DatabaseConnection } from "../src/database/connection.js";
import { referenceFrames } from "../src/database/schema.js";
import { ApiError } from "../src/errors.js";
import { createDesignType } from "../src/services/design-types.js";
import { ReferenceStorage } from "../src/storage/reference-storage.js";
import { createTestApp, disposeTestApp, validDesignTypeInput, type TestAppContext } from "./helpers.js";

describe("website reference API and storage", () => {
  let context: TestAppContext;
  let connection: DatabaseConnection;
  let frames: CapturedFrame[];
  let capture: ReturnType<typeof vi.fn<CaptureService["capture"]>>;
  let close: ReturnType<typeof vi.fn<CaptureService["close"]>>;

  beforeEach(async () => {
    const buffer = await sharp({ create: { width: 1440, height: 900, channels: 3, background: "white" } }).png().toBuffer();
    frames = [
      { name: "viewport", frameType: "viewport", buffer }, { name: "hero", frameType: "hero", buffer },
      { name: "scroll-50", frameType: "scroll", buffer }, { name: "scroll-80", frameType: "scroll", buffer },
    ];
    capture = vi.fn().mockImplementation(async () => ({ frames }));
    close = vi.fn().mockResolvedValue(undefined);
    context = await createTestApp("capture-api", { captureService: { capture, close } });
    connection = createDatabaseConnection(context.databasePath);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await disposeTestApp(context);
    expect(close).toHaveBeenCalled();
  });

  function post(payload: object = { url: "https://example.com/" }) {
    return context.app.inject({ method: "POST", url: "/api/v1/references/url", payload });
  }

  it("stores UUID-named frames, a primary thumbnail and pending website metadata", async () => {
    const type = createDesignType(connection, validDesignTypeInput);
    const response = await post({ url: "https://example.com/study", title: "Captured Editorial", designTypeId: type.id });
    expect(response.statusCode, response.body).toBe(201);
    const reference = referenceResponseSchema.parse(response.json());
    expect(reference).toMatchObject({ title: "Captured Editorial", sourceType: "website", sourceUrl: "https://example.com/study",
      analysisStatus: "pending", designTypeId: type.id, image: { width: 1440, height: 900, format: "png" } });
    expect(reference.originalPath).toBe(`captures/${reference.id}/viewport.png`);
    expect(reference.frames.map(({ frameType, sortOrder }) => [frameType, sortOrder])).toEqual([["viewport", 0], ["hero", 1], ["scroll", 2], ["scroll", 3]]);
    expect(new Set(reference.frames.map((frame) => frame.id)).size).toBe(4);
    for (const frame of reference.frames) expect(readFileSync(join(context.storageRoot, frame.imagePath))).toEqual(frames[0]!.buffer);
    expect((await sharp(readFileSync(join(context.storageRoot, reference.thumbnailPath))).metadata()).width).toBe(640);
    expect(existsSync(join(context.storageRoot, "originals"))).toBe(false);
    const detail = await context.app.inject({ method: "GET", url: `/api/v1/references/${reference.id}` });
    expect(detail.json()).toEqual(reference);
    const list = await context.app.inject({ method: "GET", url: "/api/v1/references?q=Captured&status=pending" });
    expect(referenceListResponseSchema.parse(list.json()).items[0]?.frames).toEqual(reference.frames);
    const manifest = await context.app.inject({ method: "GET", url: "/api/v1/analysis/pending" });
    const pending = pendingAnalysisManifestSchema.parse(manifest.json());
    expect(pending.unavailable).toEqual([]);
    expect(pending.references[0]?.imagePath).toBe(join(context.storageRoot, reference.originalPath));
    expect(pending.references[0]?.frames).toHaveLength(4);
  });

  it("uses the submitted hostname when no title is supplied and supports optional full-page frames", async () => {
    frames.push({ name: "fullpage", frameType: "fullpage", buffer: frames[0]!.buffer });
    const response = await post({ url: "https://example.com/", fullPage: true });
    expect(response.statusCode).toBe(201);
    expect(response.json().title).toBe("example.com");
    expect(response.json().frames).toHaveLength(5);
    expect(capture).toHaveBeenCalledWith({ url: "https://example.com/", fullPage: true });
    const exported = await context.app.inject({ method: "POST", url: "/api/v1/export/references", payload: { mode: "references", referenceIds: [response.json().id] } });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).toContain("https://example.com/");
  });

  it("rejects unsafe/invalid input and unknown design types before launching capture", async () => {
    for (const payload of [{ url: "file:///bad" }, { url: "http://127.0.0.1/" }, { url: "https://example.com/", args: ["--no-sandbox"] },
      { url: "https://example.com/", fullPage: "true" }]) expect((await post(payload)).statusCode).toBe(400);
    expect((await post({ url: "https://example.com/", designTypeId: randomUUID() })).statusCode).toBe(404);
    expect(capture).not.toHaveBeenCalled();
    expect(existsSync(context.storageRoot)).toBe(false);
  });

  it.each([[504, "CAPTURE_TIMEOUT"], [503, "CAPTURE_BROWSER_UNAVAILABLE"], [502, "CAPTURE_FAILED"], [429, "CAPTURE_BUSY"]] as const)
    ("reports %s/%s without creating a broken reference or files", async (statusCode, code) => {
      capture.mockRejectedValueOnce(new ApiError(statusCode, code, "Capture failed"));
      const response = await post();
      expect(response.statusCode).toBe(statusCode);
      expect(response.json().error.code).toBe(code);
      expect(connection.sqlite.prepare('SELECT count(*) AS total FROM "references"').get()).toEqual({ total: 0 });
      expect(existsSync(context.storageRoot)).toBe(false);
    });

  it("rolls back files and database rows if frame insertion fails", async () => {
    connection.sqlite.exec("CREATE TRIGGER deny_frames BEFORE INSERT ON reference_frames BEGIN SELECT RAISE(ABORT, 'test constraint'); END");
    const response = await post();
    expect(response.statusCode).toBe(500);
    expect(connection.sqlite.prepare('SELECT count(*) AS total FROM "references"').get()).toEqual({ total: 0 });
    expect(connection.sqlite.prepare("SELECT count(*) AS total FROM reference_frames").get()).toEqual({ total: 0 });
    expect(connection.sqlite.prepare("SELECT count(*) AS total FROM reference_search").get()).toEqual({ total: 0 });
    expect(readdirSync(join(context.storageRoot, "captures"))).toEqual([]);
    expect(readdirSync(join(context.storageRoot, "thumbnails"))).toEqual([]);
  });

  it("rolls back only newly created images on storage failure and preserves preexisting files", async () => {
    const storage = new ReferenceStorage(context.storageRoot);
    const id = randomUUID();
    const captureDirectory = join(context.storageRoot, "captures", id);
    mkdirSync(captureDirectory, { recursive: true });
    const retained = join(captureDirectory, "hero.png");
    writeFileSync(retained, "existing file");
    await expect(storage.storeCapture(id, frames)).rejects.toThrow();
    expect(readFileSync(retained, "utf8")).toBe("existing file");
    expect(existsSync(join(captureDirectory, "viewport.png"))).toBe(false);
    expect(readdirSync(captureDirectory)).toEqual(["hero.png"]);
    frames[1] = { ...frames[1]!, buffer: Buffer.from("invalid image") };
    const response = await post();
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("CAPTURE_STORAGE_FAILED");
    expect(connection.sqlite.prepare('SELECT count(*) AS total FROM "references"').get()).toEqual({ total: 0 });
  });

  it("deletes database frames first, then only associated capture files and thumbnail", async () => {
    const first = referenceResponseSchema.parse((await post()).json());
    const second = referenceResponseSchema.parse((await post()).json());
    const unrelated = join(context.storageRoot, "captures", first.id, "personal.txt");
    writeFileSync(unrelated, "Keep me");
    const response = await context.app.inject({ method: "DELETE", url: `/api/v1/references/${first.id}` });
    expect(response.statusCode).toBe(204);
    expect(connection.database.select().from(referenceFrames).where(eq(referenceFrames.referenceId, first.id)).all()).toEqual([]);
    for (const frame of first.frames) expect(existsSync(join(context.storageRoot, frame.imagePath))).toBe(false);
    expect(existsSync(join(context.storageRoot, first.thumbnailPath))).toBe(false);
    expect(readFileSync(unrelated, "utf8")).toBe("Keep me");
    for (const frame of second.frames) expect(existsSync(join(context.storageRoot, frame.imagePath))).toBe(true);
  });

  it("preserves all files if database deletion is rejected", async () => {
    const reference = referenceResponseSchema.parse((await post()).json());
    connection.sqlite.exec('CREATE TRIGGER deny_delete BEFORE DELETE ON "references" BEGIN SELECT RAISE(ABORT, \'protected\'); END');
    const response = await context.app.inject({ method: "DELETE", url: `/api/v1/references/${reference.id}` });
    expect(response.statusCode).toBe(409);
    for (const frame of reference.frames) expect(existsSync(join(context.storageRoot, frame.imagePath))).toBe(true);
    expect(connection.database.select().from(referenceFrames).all()).toHaveLength(4);
  });

  it("refuses traversal and directory symlinks for capture storage and cleanup", async () => {
    const storage = new ReferenceStorage(context.storageRoot);
    await expect(storage.storeCapture("../outside", frames)).rejects.toThrow();
    const id = randomUUID();
    const outside = join(context.directory, "outside");
    mkdirSync(outside);
    mkdirSync(context.storageRoot);
    symlinkSync(outside, join(context.storageRoot, "captures"), "junction");
    await expect(storage.storeCapture(id, frames)).rejects.toThrow(/symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
    const cleanup = await storage.deleteReferenceFiles(id, `captures/${id}/viewport.png`, `thumbnails/${id}.webp`, ["../../outside/private.png"]);
    expect(cleanup.warnings.length).toBeGreaterThan(0);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("enforces frame foreign keys, unique order and valid frame types", async () => {
    const reference = referenceResponseSchema.parse((await post()).json());
    const frame = reference.frames[0]!;
    expect(() => connection.database.insert(referenceFrames).values({ ...frame, id: randomUUID(), imagePath: "other.png" }).run()).toThrow();
    expect(() => connection.database.insert(referenceFrames).values({ ...frame, id: randomUUID(), referenceId: randomUUID(), imagePath: "missing.png" }).run()).toThrow();
    expect(() => connection.sqlite.prepare("UPDATE reference_frames SET frame_type = 'invalid' WHERE id = ?").run(frame.id)).toThrow();
  });
});
