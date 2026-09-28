import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { pendingAnalysisManifestSchema, referenceResponseSchema } from "@retr0vault/shared";

import { LocalBlobStore } from "../src/storage/local-blob-store.js";
import { MotionStorage } from "../src/storage/motion-storage.js";
import { createMultipartPayload, createTestApp, disposeTestApp, remoteLike, type TestAppContext } from "./helpers.js";

/*
 * With files in the bucket there are no local paths, so the curator
 * manifests point at copies in the inbox folders, fetched once and refreshed
 * when the stored file changes. These tests use a local store that hides its
 * paths, which the code cannot tell from the bucket.
 */

describe("files kept in a bucket", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  const plate = (background: string) => sharp({ create: { width: 48, height: 32, channels: 3, background } }).png().toBuffer();

  async function pendingManifest() {
    const response = await context.app.inject({ url: "/api/v1/analysis/pending" });
    expect(response.statusCode, response.body).toBe(200);
    return pendingAnalysisManifestSchema.parse(response.json());
  }

  it("gives curators inbox copies of images, reused until the stored image changes", async () => {
    context = await createTestApp("cloud-analysis", { remoteStorage: true });
    const red = await plate("red");
    const created = await context.app.inject({
      method: "POST", url: "/api/v1/references/image", ...createMultipartPayload({ fields: { title: "Bucket plate" }, file: { buffer: red } }),
    });
    const reference = referenceResponseSchema.parse(created.json());

    // The API still serves the image from the store.
    const media = await context.app.inject({ url: `/api/v1/media/${reference.id}/original` });
    expect(media.statusCode).toBe(200);
    expect(media.rawPayload).toEqual(red);

    const [entry] = (await pendingManifest()).references;
    const copy = join(context.directory, "data", "analysis-inbox", "images", "originals", `${reference.id}.png`);
    expect(entry!.imagePath).toBe(copy);
    expect(readFileSync(copy)).toEqual(red);

    // Unchanged: the same copy, not fetched again.
    const first = statSync(copy);
    expect((await pendingManifest()).references[0]!.imagePath).toBe(copy);
    expect(statSync(copy).ino).toBe(first.ino);

    // Replaced (same key, new bytes): the copy is refreshed.
    const green = await plate("green");
    const replaced = await context.app.inject({
      method: "PUT", url: `/api/v1/references/${reference.id}/image`, ...createMultipartPayload({ file: { buffer: green } }),
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect((await pendingManifest()).references[0]!.imagePath).toBe(copy);
    expect(readFileSync(copy)).toEqual(green);
  });

  it("copies every website frame", async () => {
    const viewport = await plate("red");
    const other = await plate("blue");
    context = await createTestApp("cloud-website", {
      remoteStorage: true,
      captureService: {
        capture: async () => ({ frames: [
          { name: "viewport", frameType: "viewport", buffer: viewport },
          { name: "scroll-50", frameType: "scroll", buffer: other },
          { name: "scroll-80", frameType: "scroll", buffer: other },
        ] }),
        close: async () => undefined,
      },
    });
    const created = await context.app.inject({ method: "POST", url: "/api/v1/references/url", payload: { url: "https://example.com/" } });
    const reference = referenceResponseSchema.parse(created.json());
    const [entry] = (await pendingManifest()).references;
    const images = join(context.directory, "data", "analysis-inbox", "images");
    expect(entry!.imagePath).toBe(join(images, "captures", reference.id, "viewport.png"));
    expect(entry!.frames.map((frame) => frame.imagePath)).toEqual(
      ["viewport", "scroll-50", "scroll-80"].map((name) => join(images, "captures", reference.id, `${name}.png`)));
    expect(readFileSync(entry!.frames[1]!.imagePath)).toEqual(other);
  });

  it("gives motion evidence the same treatment", async () => {
    context = await createTestApp("cloud-motion", { remoteStorage: true });
    const storage = new MotionStorage(remoteLike(new LocalBlobStore(context.storageRoot)));
    const referenceId = randomUUID();
    const clipId = randomUUID();
    await storage.writeFile(referenceId, clipId, "poster.webp", Buffer.from("poster"));
    const inbox = join(context.directory, "data", "motion-inbox");
    const located = await storage.locate(referenceId, clipId, "poster.webp", inbox);
    expect(located).toBe(join(inbox, "evidence", "motion", referenceId, clipId, "poster.webp"));
    expect(readFileSync(located, "utf8")).toBe("poster");
    await expect(storage.locate(referenceId, clipId, "clip.mp4", inbox)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
