import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

import sharp, { type Metadata } from "sharp";

import type { ImageFormat } from "@retr0vault/shared";

import { ApiError } from "../errors.js";
import { captureFrameNames, type CapturedFrame } from "../capture/service.js";
import { z } from "zod";

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

export interface OpenReferenceImage {
  readonly file: FileHandle;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
}

function isSupportedFormat(format: string | undefined): format is ImageFormat {
  return format === "jpeg" || format === "png" || format === "webp";
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export class ReferenceStorage {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
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

  public async getOriginalImagePath(referenceId: string, storedPath: string): Promise<string> {
    const absolutePath = this.#resolveManagedPath(referenceId, storedPath, "original");
    return this.#readableImagePath(absolutePath);
  }

  public async getCaptureFramePath(referenceId: string, storedPath: string): Promise<string> {
    return this.#readableImagePath(this.#resolveManagedPath(referenceId, storedPath, "capture"));
  }

  public async openReferenceImage(
    referenceId: string,
    storedPath: string,
    kind: "original" | "thumbnail",
  ): Promise<OpenReferenceImage> {
    const absolutePath = this.#resolveManagedPath(referenceId, storedPath, kind);
    const safePath = await this.#readableImagePath(absolutePath);
    const before = await lstat(safePath);
    const file = await open(safePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      // Serve the verified handle, not a path that is reopened later by HTTP.
      // Recheck both directory safety and identity after opening to reject swaps.
      const after = await lstat(await this.#readableImagePath(absolutePath));
      if (!stat.isFile() || stat.size === 0 || stat.dev !== before.dev || stat.ino !== before.ino ||
          stat.dev !== after.dev || stat.ino !== after.ino) {
        throw new Error("Reference image changed while opening or is not a regular image file");
      }
      const contentType = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[extname(storedPath)];
      if (contentType === undefined) throw new Error("Unsupported reference image extension");
      const validator = createHash("sha256").update(
        [referenceId, kind, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":"),
      ).digest("hex");
      return { file, contentType, size: stat.size, etag: `W/"${validator}"` };
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async #readableImagePath(absolutePath: string): Promise<string> {
    await this.#safeDirectory(dirname(absolutePath), false);
    const entry = await lstat(absolutePath);
    const canonicalRoot = await realpath(this.#root);
    const canonicalPath = await realpath(absolutePath);
    const relativePath = relative(canonicalRoot, canonicalPath);
    if (!entry.isFile() || entry.isSymbolicLink() || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Original image is not a regular file inside the storage root");
    }
    return canonicalPath;
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
        const storedPath = `captures/${referenceId}/${frame.name}.png`;
        const absolutePath = this.#resolveManagedPath(referenceId, storedPath, "capture");
        await this.#safeDirectory(dirname(absolutePath), true);
        await this.#writeExclusive(absolutePath, frame.buffer, () => written.push(storedPath));
      }
      const thumbnail = this.#resolveManagedPath(referenceId, thumbnailPath, "thumbnail");
      await this.#safeDirectory(dirname(thumbnail), true);
      const buffer = await sharp(frames[0].buffer).resize({ width: 640, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      await this.#writeExclusive(thumbnail, buffer, () => written.push(thumbnailPath));
      return { ...await this.inspectImage(frames[0].buffer), originalPath, thumbnailPath,
        frames: frames.map((frame, sortOrder) => ({ frameType: frame.frameType, imagePath: `captures/${referenceId}/${frame.name}.png`, sortOrder })) };
    } catch (error) {
      // Include partially written files, but never paths owned by an earlier call.
      for (const storedPath of written) {
        const absolutePath = this.#resolveManagedPath(referenceId, storedPath, storedPath.startsWith("captures/") ? "capture" : "thumbnail");
        await this.#safeDirectory(dirname(absolutePath), false).then(() => unlinkIfPresent(absolutePath)).catch(() => undefined);
      }
      await this.#removeEmptyCaptureDirectory(referenceId);
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
    const originalAbsolutePath = this.#resolveManagedPath(
      referenceId,
      originalPath,
      "original",
    );
    const thumbnailAbsolutePath = this.#resolveManagedPath(
      referenceId,
      thumbnailPath,
      "thumbnail",
    );

    // Decode before creating files: header-valid but truncated images are 400s.
    let thumbnail: Buffer;
    try {
      thumbnail = await sharp(buffer, {
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

    const written: string[] = [];
    try {
      await this.#safeDirectory(dirname(originalAbsolutePath), true);
      await this.#safeDirectory(dirname(thumbnailAbsolutePath), true);
      await this.#writeExclusive(originalAbsolutePath, buffer, () => written.push(originalAbsolutePath));
      await this.#writeExclusive(thumbnailAbsolutePath, thumbnail, () => written.push(thumbnailAbsolutePath));
    } catch (error) {
      await Promise.allSettled(written.map(async (path) => {
        await this.#safeDirectory(dirname(path), false);
        await unlinkIfPresent(path);
      }));
      throw error;
    }

    return { ...metadata, originalPath, thumbnailPath };
  }

  public async deleteReferenceFiles(
    referenceId: string,
    originalPath: string,
    thumbnailPath: string,
    framePaths: string[] = [],
  ): Promise<FileCleanupResult> {
    const warnings: string[] = [];

    const entries: Array<["original" | "thumbnail" | "capture", string]> = [
      ["original", originalPath],
      ["thumbnail", thumbnailPath],
      ...framePaths.filter((path) => path !== originalPath).map((path): ["capture", string] => ["capture", path]),
    ];
    for (const [kind, storedPath] of entries) {
      try {
        const absolutePath = this.#resolveManagedPath(
          referenceId,
          storedPath,
          kind,
        );
        await this.#safeDirectory(dirname(absolutePath), false);
        await unlinkIfPresent(absolutePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          warnings.push(`${kind}: managed file could not be removed safely`);
        }
      }
    }

    if (originalPath.startsWith("captures/")) await this.#removeEmptyCaptureDirectory(referenceId);

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

  #resolveManagedPath(
    referenceId: string,
    storedPath: string,
    kind: "original" | "thumbnail" | "capture",
  ): string {
    z.uuid().parse(referenceId);
    if (isAbsolute(storedPath) || storedPath.includes("\\")) {
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

    const absolutePath = resolve(this.#root, storedPath);
    const relativePath = relative(this.#root, absolutePath);
    if (
      relativePath === "" ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      throw new Error("Stored image path resolves outside the storage root");
    }

    return absolutePath;
  }

  async #safeDirectory(directory: string, create: boolean): Promise<void> {
    const parts = relative(this.#root, directory).split(/[\\/]/).filter(Boolean);
    if (parts.some((part) => part === "..") || isAbsolute(relative(this.#root, directory))) throw new Error("Unsafe storage directory");
    if (create) await mkdir(this.#root, { recursive: true });
    const rootEntry = await lstat(this.#root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error("Storage root must be a real directory");
    let current = this.#root;
    for (const part of parts) {
      current = resolve(current, part);
      if (create) await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Storage directory must be inside the storage root and must not be a symbolic link");
    }
  }

  async #writeExclusive(path: string, buffer: Buffer, onCreated: () => void): Promise<void> {
    // wx refuses an existing file or link. Record ownership before the first write
    // so disk-full errors cannot leave an untracked partially written file.
    const handle = await open(path, "wx");
    onCreated();
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #removeEmptyCaptureDirectory(referenceId: string): Promise<void> {
    const directory = dirname(this.#resolveManagedPath(referenceId, `captures/${referenceId}/viewport.png`, "capture"));
    await this.#safeDirectory(directory, false).then(() => rmdir(directory)).catch(() => undefined);
  }
}
