import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { get } from "node:http";
import { dirname, join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponseSchema, referenceResponseSchema, type ImageFormat } from "@retr0vault/shared";

import { createDatabaseConnection, type DatabaseConnection } from "../src/database/connection.js";
import type { CapturedFrame } from "../src/capture/service.js";
import { ReferenceStorage } from "../src/storage/reference-storage.js";
import { createMultipartPayload, createTestApp, disposeTestApp, type TestAppContext } from "./helpers.js";

describe("ID-based reference media", () => {
  let context: TestAppContext;
  let connection: DatabaseConnection;
  let original: Buffer;
  let captureFrames: CapturedFrame[];

  beforeEach(async () => {
    original = await sharp({ create: { width: 96, height: 64, channels: 3, background: "red" } }).png().toBuffer();
    const other = await sharp({ create: { width: 96, height: 64, channels: 3, background: "blue" } }).png().toBuffer();
    captureFrames = [
      { name: "viewport", frameType: "viewport", buffer: original },
      { name: "scroll-50", frameType: "scroll", buffer: other },
      { name: "scroll-80", frameType: "scroll", buffer: other },
    ];
    context = await createTestApp("media", { captureService: {
      capture: async () => ({ frames: captureFrames }), close: async () => undefined,
    } });
    connection = createDatabaseConnection(context.databasePath);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    connection.sqlite.close();
    await disposeTestApp(context);
  });

  async function upload(buffer = original) {
    const multipart = createMultipartPayload({ fields: { title: "Media Reference" }, file: { buffer, filename: "../../misleading.gif" } });
    const response = await context.app.inject({ method: "POST", url: "/api/v1/references/image", ...multipart });
    expect(response.statusCode, response.body).toBe(201);
    return referenceResponseSchema.parse(response.json());
  }
  const url = (id: string, kind = "original") => `/api/v1/media/${id}/${kind}`;
  function expectNotFound(response: Awaited<ReturnType<TestAppContext["app"]["inject"]>>, code = "MEDIA_NOT_FOUND") {
    expect(response.statusCode, response.body).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeUndefined();
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(code);
    expect(response.body).not.toContain(context.directory);
  }
  function trackOpenedFiles(): FileHandle[] {
    const opened: FileHandle[] = [];
    const openImage = ReferenceStorage.prototype.openReferenceImage;
    vi.spyOn(ReferenceStorage.prototype, "openReferenceImage").mockImplementation(async function (this: ReferenceStorage, ...args) {
      const media = await openImage.apply(this, args);
      opened.push(media.file);
      return media;
    });
    return opened;
  }

  it.each(["jpeg", "png", "webp"] as const)("returns exact %s originals and generated WebP thumbnails", async (format: ImageFormat) => {
    const bytes = await sharp(original).toFormat(format).toBuffer();
    const reference = await upload(bytes);
    const before = connection.sqlite.prepare('SELECT * FROM "references"').all();
    for (const kind of ["original", "thumbnail"] as const) {
      const response = await context.app.inject({ url: url(reference.id.toUpperCase(), kind), headers: { origin: "http://localhost:4610" } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe(`image/${kind === "thumbnail" ? "webp" : format}`);
      const expected = kind === "original" ? bytes : readFileSync(join(context.storageRoot, reference.thumbnailPath));
      expect(response.rawPayload).toEqual(expected);
      expect(response.headers["content-length"]).toBe(String(expected.length));
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["cache-control"]).toBe("private, max-age=0, must-revalidate");
      expect(response.headers.etag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:4610");
      expect(response.headers["content-disposition"]).toBeUndefined();
    }
    expect(connection.sqlite.prepare('SELECT * FROM "references"').all()).toEqual(before);
    expect((await context.app.inject(`/api/v1/references/${reference.id}`)).json()).toEqual(reference);
  });

  it("serves a website's primary viewport and thumbnail without exposing other frames", async () => {
    const response = await context.app.inject({ method: "POST", url: "/api/v1/references/url", payload: { url: "https://example.com/" } });
    expect(response.statusCode).toBe(201);
    const reference = referenceResponseSchema.parse(response.json());
    const media = await context.app.inject(url(reference.id));
    expect(media.statusCode).toBe(200);
    expect(media.headers["content-type"]).toBe("image/png");
    expect(media.rawPayload).toEqual(original);
    const thumbnail = await context.app.inject(url(reference.id, "thumbnail"));
    expect(thumbnail.headers["content-type"]).toBe("image/webp");
    expect(thumbnail.rawPayload).toEqual(readFileSync(join(context.storageRoot, reference.thumbnailPath)));
    expectNotFound(await context.app.inject(url(reference.id, "scroll-50.png")), "ROUTE_NOT_FOUND");
  });

  it("returns HEAD headers without reading a body, and closes handles for GET, HEAD and 304", async () => {
    const reference = await upload();
    const opened = trackOpenedFiles();
    for (const kind of ["original", "thumbnail"]) {
      const first = await context.app.inject(url(reference.id, kind));
      const head = await context.app.inject({ method: "HEAD", url: url(reference.id, kind) });
      expect(head.statusCode).toBe(200);
      expect(head.rawPayload.length).toBe(0);
      for (const header of ["content-type", "content-length", "cache-control", "etag"]) expect(head.headers[header]).toBe(first.headers[header]);
      const etag = String(first.headers.etag);
      const cachedHead = await context.app.inject({ method: "HEAD", url: url(reference.id, kind), headers: { "if-none-match": etag } });
      expect(cachedHead.statusCode).toBe(304);
      expect(cachedHead.body).toBe("");
      expect(cachedHead.headers["content-length"]).toBeUndefined();
      for (const validator of [etag, etag.slice(2), `"other", ${etag}`, "*"]) {
        const cached = await context.app.inject({ url: url(reference.id, kind), headers: { "if-none-match": validator } });
        expect(cached.statusCode).toBe(304);
        expect(cached.body).toBe("");
        expect(cached.headers.etag).toBe(etag);
        expect(cached.headers["content-length"]).toBeUndefined();
      }
      expect((await context.app.inject({ url: url(reference.id, kind), headers: { "if-none-match": '"unmatched"' } })).statusCode).toBe(200);
    }
    await vi.waitFor(() => expect(opened.every((file) => file.fd === -1)).toBe(true));
  });

  it("changes the validator when the stored image changes", async () => {
    const reference = await upload();
    const first = await context.app.inject(url(reference.id));
    const replacement = await sharp({ create: { width: 32, height: 20, channels: 3, background: "green" } }).png().toBuffer();
    writeFileSync(join(context.storageRoot, reference.originalPath), replacement);
    const second = await context.app.inject({ url: url(reference.id), headers: { "if-none-match": String(first.headers.etag) } });
    expect(second.statusCode).toBe(200);
    expect(second.rawPayload).toEqual(replacement);
    expect(second.headers.etag).not.toBe(first.headers.etag);
  });

  it.each(["original", "thumbnail"])("returns structured 404 for a missing %s, even with a cached validator", async (kind) => {
    const reference = await upload();
    const first = await context.app.inject(url(reference.id, kind));
    unlinkSync(join(context.storageRoot, kind === "original" ? reference.originalPath : reference.thumbnailPath));
    expectNotFound(await context.app.inject({ url: url(reference.id, kind), headers: { "if-none-match": String(first.headers.etag) } }));
    const unaffected = kind === "original" ? "thumbnail" : "original";
    expect((await context.app.inject(url(reference.id, unaffected))).statusCode).toBe(200);
  });

  it("never serves orphan files for an unknown or deleted reference", async () => {
    const reference = await upload();
    const cached = await context.app.inject(url(reference.id));
    // Simulate a committed deletion with files still awaiting cleanup.
    connection.sqlite.prepare('DELETE FROM "references" WHERE id = ?').run(reference.id);
    for (const id of [reference.id, randomUUID()]) for (const kind of ["original", "thumbnail"]) {
      expectNotFound(await context.app.inject({ url: url(id, kind), headers: { "if-none-match": String(cached.headers.etag) } }), "REFERENCE_NOT_FOUND");
    }
    expect(readFileSync(join(context.storageRoot, reference.originalPath))).toEqual(original);
  });

  it("returns a structured 404 for an empty or unreadable image without exposing filesystem errors", async () => {
    const reference = await upload();
    writeFileSync(join(context.storageRoot, reference.thumbnailPath), "");
    expectNotFound(await context.app.inject(url(reference.id, "thumbnail")));
    vi.spyOn(ReferenceStorage.prototype, "openReferenceImage").mockRejectedValueOnce(
      Object.assign(new Error(`Access denied: ${context.directory}`), { code: "EACCES" }),
    );
    expectNotFound(await context.app.inject(url(reference.id)));
  });

  it.each(["not-a-uuid", "%2e%2e%5cprivate", "%2e%2e%2fprivate", "C%3A%5cprivate", "..%252fprivate"])("rejects invalid/traversal ID %s", async (id) => {
    const response = await context.app.inject(url(id));
    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts no path query and exposes no static storage or directory listing", async () => {
    const reference = await upload();
    for (const query of ["?path=../../private", "?filename=secret", "?variant=thumbnail"]) {
      expect((await context.app.inject(url(reference.id) + query)).statusCode).toBe(400);
    }
    for (const path of ["/storage/", `/storage/${reference.originalPath}`, "/api/v1/media/", `/api/v1/media/${reference.id}/`, url(reference.id, "original/private.png")]) {
      expectNotFound(await context.app.inject(path), "ROUTE_NOT_FOUND");
    }
  });

  it("refuses corrupted stored paths, including another reference's otherwise valid image", async () => {
    const reference = await upload();
    const other = await upload();
    const outside = join(context.directory, "private.png"); writeFileSync(outside, "private sentinel");
    for (const path of [outside, "../private.png", "originals/../../private.png", "originals\\private.png", other.originalPath,
      reference.thumbnailPath, `captures/${reference.id}/scroll-50.png`]) {
      connection.sqlite.prepare('UPDATE "references" SET original_path = ? WHERE id = ?').run(path, reference.id);
      expectNotFound(await context.app.inject(url(reference.id)));
    }
    connection.sqlite.prepare('UPDATE "references" SET thumbnail_path = ? WHERE id = ?').run(other.thumbnailPath, reference.id);
    expectNotFound(await context.app.inject(url(reference.id, "thumbnail")));
    expect(readFileSync(outside, "utf8")).toBe("private sentinel");
  });

  it.each(["original", "thumbnail"])("rejects linked parent directories and directories masquerading as %s files", async (kind) => {
    const reference = await upload();
    const stored = kind === "original" ? reference.originalPath : reference.thumbnailPath;
    const file = join(context.storageRoot, stored);
    unlinkSync(file); mkdirSync(file);
    expectNotFound(await context.app.inject(url(reference.id, kind)));
    const managed = dirname(file);
    renameSync(managed, `${managed}-saved`);
    const outside = join(context.directory, "private"); mkdirSync(outside);
    writeFileSync(join(outside, stored.split("/").at(-1)!), original);
    symlinkSync(outside, managed, "junction");
    expectNotFound(await context.app.inject(url(reference.id, kind)));
  });

  it("rejects linked capture directories and linked storage roots", async () => {
    const captured = await context.app.inject({ method: "POST", url: "/api/v1/references/url", payload: { url: "https://example.com/" } });
    const reference = referenceResponseSchema.parse(captured.json());
    const directory = dirname(join(context.storageRoot, reference.originalPath));
    renameSync(directory, `${directory}-saved`);
    const outside = join(context.directory, "private"); mkdirSync(outside);
    writeFileSync(join(outside, "viewport.png"), original);
    symlinkSync(outside, directory, "junction");
    expectNotFound(await context.app.inject(url(reference.id)));
    renameSync(context.storageRoot, `${context.storageRoot}-saved`);
    symlinkSync(`${context.storageRoot}-saved`, context.storageRoot, "junction");
    expectNotFound(await context.app.inject(url(reference.id, "thumbnail")));
  });

  it("streams the already verified handle instead of reopening a replaced pathname", async () => {
    const reference = await upload();
    const openImage = ReferenceStorage.prototype.openReferenceImage;
    vi.spyOn(ReferenceStorage.prototype, "openReferenceImage").mockImplementation(async function (this: ReferenceStorage, ...args) {
      const media = await openImage.apply(this, args);
      const path = join(context.storageRoot, reference.originalPath);
      renameSync(path, `${path}.saved`);
      writeFileSync(path, "replacement must not be served by this request");
      return media;
    });
    const response = await context.app.inject(url(reference.id));
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(original);
  });

  it.each(["creation", "read"])("returns uncached JSON and closes the handle after a stream %s failure before sending bytes", async (failure) => {
    const reference = await upload();
    const opened: FileHandle[] = [];
    const openImage = ReferenceStorage.prototype.openReferenceImage;
    vi.spyOn(ReferenceStorage.prototype, "openReferenceImage").mockImplementation(async function (this: ReferenceStorage, ...args) {
      const media = await openImage.apply(this, args);
      opened.push(media.file);
      const createStream = media.file.createReadStream.bind(media.file);
      vi.spyOn(media.file, "createReadStream").mockImplementation((options) => {
        const error = new Error(`Read failed: ${context.directory}`);
        if (failure === "creation") throw error;
        const stream = createStream(options);
        queueMicrotask(() => stream.destroy(error));
        return stream;
      });
      return media;
    });
    const response = await context.app.inject(url(reference.id));
    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBeUndefined();
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(response.body).not.toContain(context.directory);
    await vi.waitFor(() => expect(opened[0]!.fd).toBe(-1));
  });

  it("keeps the existing origin protection and streams over real HTTP, closing aborted transfers", async () => {
    const large = await sharp(randomBytes(512 * 512 * 3), { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
    const reference = await upload(large);
    expect((await context.app.inject({ url: url(reference.id), headers: { origin: "https://untrusted.example" } })).statusCode).toBe(403);
    const address = await context.app.listen({ host: "127.0.0.1", port: 0 });
    const complete = await fetch(address + url(reference.id));
    expect(complete.status).toBe(200);
    expect(Buffer.from(await complete.arrayBuffer())).toEqual(large);
    const opened = trackOpenedFiles();
    await new Promise<void>((resolve, reject) => {
      const request = get(address + url(reference.id), (response) => {
        response.once("data", () => { response.destroy(); resolve(); });
        response.once("error", reject);
      });
      request.once("error", reject);
    });
    await vi.waitFor(() => {
      expect(opened.length).toBe(1);
      expect(opened[0]!.fd).toBe(-1);
    });
  });
});
