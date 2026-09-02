import { lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import sharp, { type Metadata } from "sharp";

import type { ImageFormat } from "@retr0vault/shared";

import { ApiError } from "../errors.js";

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

export interface FileCleanupResult {
  readonly warnings: string[];
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
    const entry = await lstat(absolutePath);
    const canonicalRoot = await realpath(this.#root);
    const canonicalPath = await realpath(absolutePath);
    const relativePath = relative(canonicalRoot, canonicalPath);
    if (!entry.isFile() || entry.isSymbolicLink() || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Original image is not a regular file inside the storage root");
    }
    return canonicalPath;
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

    await mkdir(resolve(this.#root, "originals"), { recursive: true });
    await mkdir(resolve(this.#root, "thumbnails"), { recursive: true });

    let originalWritten = false;
    try {
      await writeFile(originalAbsolutePath, buffer, { flag: "wx" });
      originalWritten = true;

      await sharp(buffer, {
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
        .toFile(thumbnailAbsolutePath);
    } catch (error) {
      await Promise.allSettled([
        unlinkIfPresent(thumbnailAbsolutePath),
        ...(originalWritten ? [unlinkIfPresent(originalAbsolutePath)] : []),
      ]);
      throw error;
    }

    return { ...metadata, originalPath, thumbnailPath };
  }

  public async deleteReferenceFiles(
    referenceId: string,
    originalPath: string,
    thumbnailPath: string,
  ): Promise<FileCleanupResult> {
    const warnings: string[] = [];

    for (const [kind, storedPath] of [
      ["original", originalPath],
      ["thumbnail", thumbnailPath],
    ] as const) {
      try {
        const absolutePath = this.#resolveManagedPath(
          referenceId,
          storedPath,
          kind,
        );
        await unlinkIfPresent(absolutePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        warnings.push(`${kind}: ${message}`);
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

  #resolveManagedPath(
    referenceId: string,
    storedPath: string,
    kind: "original" | "thumbnail",
  ): string {
    if (isAbsolute(storedPath) || storedPath.includes("\\")) {
      throw new Error("Stored image path must be a portable relative path");
    }

    const expectedPattern =
      kind === "original"
        ? new RegExp(
            `^originals/${referenceId}\\.(?:jpg|png|webp)$`,
            "u",
          )
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
}
