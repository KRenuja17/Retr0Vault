import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Readable } from "node:stream";

import sharp, { type Metadata } from "sharp";

import type { ImageFormat } from "@retr0vault/shared";

import { ApiError } from "../errors.js";
import { captureFrameNames, type CapturedFrame } from "../capture/service.js";
import { z } from "zod";
import { contentTypeFor, isBlobNotFound, type BlobStore } from "./blob-store.js";
import { locateLocally } from "./local-copy.js";

const originalExtensions: Record<ImageFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

export interface ImageMetadata {
  readonly width: number;
  readonly height: number;
  readonly format: ImageFormat;
}

export interface StoredReferenceImage extends ImageMetadata {
  readonly originalPath: string;
  readonly thumbnailPath: string;
}

export interface StoredWebsiteCapture extends StoredReferenceImage {
  readonly frames: Array<{ frameType: CapturedFrame["frameType"]; imagePath: string; sortOrder: number }>;
}

export interface FileCleanupResult {
  readonly warnings: string[];
}

/**
 * A replacement image already in place, with the objects it displaced kept
 * aside until the database agrees. `commit` discards the displaced copies;
 * `rollback` puts them back. Exactly one of the two must be called.
 */
export interface StagedImageReplacement {
  readonly image: StoredReferenceImage;
  commit(): Promise<FileCleanupResult>;
  rollback(): Promise<FileCleanupResult>;
}

type ManagedKind = "original" | "thumbnail" | "capture";

/** An opened reference image. Destroying `body` releases it. */
export interface OpenReferenceImage {
  readonly body: Readable;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
}

function isSupportedFormat(format: string | undefined): format is ImageFormat {
  return format === "jpeg" || format === "png" || format === "webp";
}

/** Where a displaced object waits while its replacement is not yet committed. */
const asideKey = (key: string) => `${key}.previous`;

export class ReferenceStorage {
  readonly #blobs: BlobStore;
  /** References whose image is being swapped; a second swap waits its turn. */
  readonly #replacing = new Set<string>();

  public constructor(blobs: BlobStore) {
    this.#blobs = blobs;
  }

  public async inspectImage(buffer: Buffer): Promise<ImageMetadata> {
    let metadata: Metadata;

    try {
      metadata = await sharp(buffer, {
        failOn: "error",
        limitInputPixels: 100_000_000,
      }).metadata();
    } catch {
      throw new ApiError(
        400,
        "INVALID_IMAGE",
        "The uploaded file is not a valid readable image",
      );
    }

    if (!isSupportedFormat(metadata.format)) {
      throw new ApiError(
        415,
        "UNSUPPORTED_IMAGE_FORMAT",
        "Only JPEG, PNG, and WebP images are accepted",
      );
    }

    if (metadata.width === undefined || metadata.height === undefined) {
      throw new ApiError(
        400,
        "INVALID_IMAGE",
        "The uploaded image does not contain valid dimensions",
      );
    }

    const orientationSwapsDimensions =
      metadata.orientation !== undefined &&
      metadata.orientation >= 5 &&
      metadata.orientation <= 8;

    return {
      width: orientationSwapsDimensions ? metadata.height : metadata.width,
      height: orientationSwapsDimensions ? metadata.width : metadata.height,
      format: metadata.format,
    };
  }

  /**
   * A path on this PC where a curator can read the original image: the stored
   * file itself for a local store, or a copy under `inboxDirectory/images`.
   */
  public async locateOriginalImage(referenceId: string, storedPath: string, inboxDirectory: string): Promise<string> {
    const key = this.#managedKey(referenceId, storedPath, "original");
    return locateLocally(this.#blobs, key, join(inboxDirectory, "images", key));
  }

  public async locateCaptureFrame(referenceId: string, storedPath: string, inboxDirectory: string): Promise<string> {
    const key = this.#managedKey(referenceId, storedPath, "capture");
    return locateLocally(this.#blobs, key, join(inboxDirectory, "images", key));
  }

  public async openReferenceImage(
    referenceId: string,
    storedPath: string,
    kind: "original" | "thumbnail",
  ): Promise<OpenReferenceImage> {
    const key = this.#managedKey(referenceId, storedPath, kind);
    const contentType = contentTypeFor(key);
    if (!contentType.startsWith("image/")) throw new Error("Unsupported reference image extension");
    const read = await this.#blobs.read(key);
    if (read.size === 0) {
      read.body.destroy();
      throw new Error("Reference image is empty");
    }
    const validator = createHash("sha256").update([referenceId, kind, key, read.version].join(":")).digest("hex");
    return { body: read.body, contentType, size: read.size, etag: `W/"${validator}"` };
  }

  public async storeCapture(referenceId: string, frames: CapturedFrame[]): Promise<StoredWebsiteCapture> {
    z.uuid().parse(referenceId);
    if (frames[0]?.name !== "viewport" || frames.length < 3 || frames.length > 5 ||
        new Set(frames.map((frame) => frame.name)).size !== frames.length ||
        !frames.some((frame) => frame.name === "scroll-50") || !frames.some((frame) => frame.name === "scroll-80") ||
        frames.some((frame, index) => index > 0 && captureFrameNames.indexOf(frame.name) <= captureFrameNames.indexOf(frames[index - 1]!.name))) {
      throw new Error("Capture must contain an ordered primary viewport and scroll frames");
    }
    const originalPath = `captures/${referenceId}/viewport.png`;
    const thumbnailPath = `thumbnails/${referenceId}.webp`;
    const written: string[] = [];
    try {
      for (const frame of frames) {
        if (!captureFrameNames.includes(frame.name)) throw new Error("Invalid capture frame name");
        const expectedType = frame.name.startsWith("scroll-") ? "scroll" : frame.name;
        if (frame.frameType !== expectedType) throw new Error("Invalid capture frame type");
        const metadata = await this.inspectImage(frame.buffer);
        if (metadata.format !== "png") throw new Error("Capture frames must be PNG images");
        const key = this.#managedKey(referenceId, `captures/${referenceId}/${frame.name}.png`, "capture");
        await this.#writeNew(key, frame.buffer, written);
      }
      const buffer = await sharp(frames[0].buffer).resize({ width: 640, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      await this.#writeNew(this.#managedKey(referenceId, thumbnailPath, "thumbnail"), buffer, written);
      return { ...await this.inspectImage(frames[0].buffer), originalPath, thumbnailPath,
        frames: frames.map((frame, sortOrder) => ({ frameType: frame.frameType, imagePath: `captures/${referenceId}/${frame.name}.png`, sortOrder })) };
    } catch (error) {
      // Remove what this call wrote, never objects owned by an earlier call.
      await Promise.allSettled(written.map((key) => this.#blobs.delete(key)));
      throw error;
    }
  }

  public async storeImage(
    referenceId: string,
    buffer: Buffer,
    metadata: ImageMetadata,
  ): Promise<StoredReferenceImage> {
    const originalPath = `originals/${referenceId}.${originalExtensions[metadata.format]}`;
    const thumbnailPath = `thumbnails/${referenceId}.webp`;
    const originalKey = this.#managedKey(referenceId, originalPath, "original");
    const thumbnailKey = this.#managedKey(referenceId, thumbnailPath, "thumbnail");

    // Decode before storing anything: header-valid but truncated images are 400s.
    const thumbnail = await this.#decodeThumbnail(buffer);

    const written: string[] = [];
    try {
      await this.#writeNew(originalKey, buffer, written);
      await this.#writeNew(thumbnailKey, thumbnail, written);
    } catch (error) {
      await Promise.allSettled(written.map((key) => this.#blobs.delete(key)));
      throw error;
    }

    return { ...metadata, originalPath, thumbnailPath };
  }

  /**
   * Put a new picture in place of a reference's current one. An image
   * reference keeps the uploaded bytes untouched (its extension follows the
   * new format); a website reference takes it as its primary viewport frame,
   * stored as PNG like every capture frame, and keeps its other frames.
   *
   * The current objects are first copied aside, then the new ones are written
   * under the reference's keys, so until `commit` the previous picture can
   * always be put back.
   */
  public async replaceImage(
    referenceId: string,
    current: { readonly sourceType: "image" | "website"; readonly originalPath: string; readonly thumbnailPath: string },
    buffer: Buffer,
  ): Promise<StagedImageReplacement> {
    z.uuid().parse(referenceId);
    if (this.#replacing.has(referenceId)) {
      throw new ApiError(409, "REFERENCE_IMAGE_BUSY", "This reference's image is already being replaced");
    }
    this.#replacing.add(referenceId);
    const release = () => this.#replacing.delete(referenceId);

    /** Keys that held the previous picture, now copied aside. */
    const displaced: string[] = [];
    /** Keys written with the new picture. */
    const placed: string[] = [];

    const restore = async (): Promise<FileCleanupResult> => {
      const warnings: string[] = [];
      for (const key of placed) {
        if (!displaced.includes(key)) {
          await this.#blobs.delete(key).catch(() => warnings.push("replacement: a new file could not be removed"));
        }
      }
      for (const key of displaced) {
        try {
          await this.#blobs.copy(asideKey(key), key);
          await this.#blobs.delete(asideKey(key));
        } catch {
          warnings.push("replacement: a previous file could not be restored");
        }
      }
      return { warnings };
    };

    try {
      const metadata = await this.inspectImage(buffer);
      const thumbnail = await this.#decodeThumbnail(buffer);
      const website = current.sourceType === "website";
      const original = website
        ? await sharp(buffer, { failOn: "error", limitInputPixels: 100_000_000 }).rotate().png().toBuffer()
        : buffer;
      const image: StoredReferenceImage = {
        width: metadata.width,
        height: metadata.height,
        format: website ? "png" : metadata.format,
        originalPath: website
          ? `captures/${referenceId}/viewport.png`
          : `originals/${referenceId}.${originalExtensions[metadata.format]}`,
        thumbnailPath: `thumbnails/${referenceId}.webp`,
      };
      const incoming: Array<[string, Buffer]> = [
        [this.#managedKey(referenceId, image.originalPath, "original"), original],
        [this.#managedKey(referenceId, image.thumbnailPath, "thumbnail"), thumbnail],
      ];
      const outgoing = [
        this.#managedKey(referenceId, current.originalPath, "original"),
        this.#managedKey(referenceId, current.thumbnailPath, "thumbnail"),
      ];

      for (const key of outgoing) {
        try {
          await this.#blobs.copy(key, asideKey(key));
          displaced.push(key);
        } catch (error) {
          // A picture that is already missing is exactly what is being replaced.
          if (!isBlobNotFound(error)) throw error;
        }
      }
      for (const [key, bytes] of incoming) {
        placed.push(key);
        await this.#blobs.write(key, bytes, { contentType: contentTypeFor(key) });
      }
      // A format change moves the original to a new key; the old one goes aside.
      for (const key of displaced) {
        if (!placed.includes(key)) await this.#blobs.delete(key);
      }

      return {
        image,
        commit: async () => {
          const warnings: string[] = [];
          for (const key of displaced) {
            await this.#blobs.delete(asideKey(key)).catch(() => warnings.push("replacement: a previous file could not be removed"));
          }
          release();
          return { warnings };
        },
        rollback: async () => {
          const result = await restore();
          release();
          return result;
        },
      };
    } catch (error) {
      await restore();
      release();
      throw error;
    }
  }

  public async deleteReferenceFiles(
    referenceId: string,
    originalPath: string,
    thumbnailPath: string,
    framePaths: string[] = [],
  ): Promise<FileCleanupResult> {
    const warnings: string[] = [];

    const entries: Array<[ManagedKind, string]> = [
      ["original", originalPath],
      ["thumbnail", thumbnailPath],
      ...framePaths.filter((path) => path !== originalPath).map((path): ["capture", string] => ["capture", path]),
    ];
    for (const [kind, storedPath] of entries) {
      try {
        await this.#blobs.delete(this.#managedKey(referenceId, storedPath, kind));
      } catch {
        warnings.push(`${kind}: managed file could not be removed safely`);
      }
    }

    return { warnings };
  }

  public async rollbackStoredImage(
    referenceId: string,
    image: Pick<StoredReferenceImage, "originalPath" | "thumbnailPath">,
  ): Promise<FileCleanupResult> {
    return this.deleteReferenceFiles(
      referenceId,
      image.originalPath,
      image.thumbnailPath,
    );
  }

  async #decodeThumbnail(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer, {
        failOn: "error",
        limitInputPixels: 100_000_000,
      })
        .rotate()
        .resize({
          width: 640,
          height: 480,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new ApiError(400, "INVALID_IMAGE", "The uploaded file is not a valid readable image");
    }
  }

  /** Writes a key that must not exist yet, recording it before the write so a failure can remove it. */
  async #writeNew(key: string, bytes: Buffer, written: string[]): Promise<void> {
    await this.#blobs.write(key, bytes, { contentType: contentTypeFor(key), exclusive: true });
    written.push(key);
  }

  /** The storage key of a managed file: only names the reference's own namespace allows. */
  #managedKey(
    referenceId: string,
    storedPath: string,
    kind: ManagedKind,
  ): string {
    z.uuid().parse(referenceId);
    if (storedPath.startsWith("/") || storedPath.includes("\\")) {
      throw new Error("Stored image path must be a portable relative path");
    }

    const expectedPattern =
      kind === "original"
        ? new RegExp(
            `^(?:originals/${referenceId}\\.(?:jpg|png|webp)|captures/${referenceId}/viewport\\.png)$`,
            "u",
          )
        : kind === "capture"
          ? new RegExp(`^captures/${referenceId}/(?:viewport|hero|scroll-50|scroll-80|fullpage)\\.png$`, "u")
          : new RegExp(`^thumbnails/${referenceId}\\.webp$`, "u");

    if (!expectedPattern.test(storedPath)) {
      throw new Error("Stored image path is outside the reference namespace");
    }
    return storedPath;
  }
}
