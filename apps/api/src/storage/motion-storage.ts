import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { z } from "zod";

/*
 * Files of a motion clip live in `motion/<reference-id>/<clip-id>/`. Only the
 * fixed names below are ever created, served or removed; nothing is derived
 * from user input, and no directory on the way may be a link.
 */

export const motionFileNamePattern =
  /^(?:source\.bin|clip\.mp4|clip\.part\.mp4|preview\.mp4|preview\.part\.mp4|poster\.webp|k-0(?:[01][0-9]|2[0-3])\.webp|burst-[0-3]\.webp|energy\.json|energy\.webp|regions\.webp|contact-sheet\.webp)$/u;

export type MotionMediaKind = "clip" | "preview" | "poster" | "energy" | "regions" | "contact-sheet";

const mediaFiles: Record<MotionMediaKind, { name: string; contentType: string }> = {
  clip: { name: "clip.mp4", contentType: "video/mp4" },
  preview: { name: "preview.mp4", contentType: "video/mp4" },
  poster: { name: "poster.webp", contentType: "image/webp" },
  energy: { name: "energy.webp", contentType: "image/webp" },
  regions: { name: "regions.webp", contentType: "image/webp" },
  "contact-sheet": { name: "contact-sheet.webp", contentType: "image/webp" },
};

export function keyframeFileName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 23) throw new Error("Keyframe index out of range");
  return `k-${String(index).padStart(3, "0")}.webp`;
}

export function burstFileName(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error("Burst index out of range");
  return `burst-${index}.webp`;
}

export interface OpenMotionFile {
  readonly file: FileHandle;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
}

async function unlinkIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export class MotionStorage {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
  }

  /** Storage-relative portable path, as stored in the database. */
  public relativePath(referenceId: string, clipId: string, name: string): string {
    this.#validate(referenceId, clipId, name);
    return `motion/${referenceId}/${clipId}/${name}`;
  }

  /** Absolute path of a managed file; the directories are checked when used. */
  public absolutePath(referenceId: string, clipId: string, name: string): string {
    const path = resolve(this.#root, this.relativePath(referenceId, clipId, name));
    const fromRoot = relative(this.#root, path);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new Error("Motion path resolves outside the storage root");
    return path;
  }

  public async prepareClipDirectory(referenceId: string, clipId: string): Promise<void> {
    await this.#safeDirectory(this.#clipDirectory(referenceId, clipId), true);
  }

  /** Streams an upload to `source.bin`; refuses to overwrite. Returns bytes written. */
  public async writeUpload(referenceId: string, clipId: string, stream: Readable): Promise<void> {
    await this.prepareClipDirectory(referenceId, clipId);
    const path = this.absolutePath(referenceId, clipId, "source.bin");
    try {
      await pipeline(stream, createWriteStream(path, { flags: "wx" }));
    } catch (error) {
      await unlinkIfPresent(path).catch(() => undefined);
      throw error;
    }
  }

  /** Verified absolute path of an existing managed file, for ffmpeg input. */
  public async existingPath(referenceId: string, clipId: string, name: string): Promise<string> {
    const path = this.absolutePath(referenceId, clipId, name);
    await this.#safeDirectory(this.#clipDirectory(referenceId, clipId), false);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Motion file is not a regular file");
    return path;
  }

  public async exists(referenceId: string, clipId: string, name: string): Promise<boolean> {
    return this.existingPath(referenceId, clipId, name).then(() => true, () => false);
  }

  public async writeFile(referenceId: string, clipId: string, name: string, contents: Buffer | string): Promise<void> {
    await this.prepareClipDirectory(referenceId, clipId);
    const path = this.absolutePath(referenceId, clipId, name);
    // `wx` refuses an existing file or link; callers clear generated files first.
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /** Atomically moves a finished `*.part.mp4` into place. */
  public async promote(referenceId: string, clipId: string, from: "clip.part.mp4" | "preview.part.mp4"): Promise<void> {
    const source = await this.existingPath(referenceId, clipId, from);
    const target = this.absolutePath(referenceId, clipId, from.replace(".part", ""));
    await unlinkIfPresent(target);
    await rename(source, target);
  }

  public async removeFile(referenceId: string, clipId: string, name: string): Promise<void> {
    await this.#safeDirectory(this.#clipDirectory(referenceId, clipId), false).catch(() => undefined);
    await unlinkIfPresent(this.absolutePath(referenceId, clipId, name));
  }

  /** Removes every generated file of a clip, keeping `source.bin` for a retry. */
  public async clearGenerated(referenceId: string, clipId: string): Promise<void> {
    for (const name of await this.#listClip(referenceId, clipId)) {
      if (name !== "source.bin") await unlinkIfPresent(this.absolutePath(referenceId, clipId, name));
    }
  }

  /** Removes a clip's managed files and its directory. Unknown files are left and reported. */
  public async removeClip(referenceId: string, clipId: string): Promise<string[]> {
    const warnings: string[] = [];
    try {
      for (const name of await this.#listClip(referenceId, clipId)) {
        await unlinkIfPresent(this.absolutePath(referenceId, clipId, name));
      }
      await rmdir(this.#clipDirectory(referenceId, clipId)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") warnings.push("motion clip directory still contains unmanaged files");
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push("motion clip files could not be removed safely");
    }
    return warnings;
  }

  /** Removes every clip directory of a study and the study directory itself. */
  public async removeStudy(referenceId: string): Promise<string[]> {
    z.uuid().parse(referenceId);
    const directory = resolve(this.#root, "motion", referenceId);
    const warnings: string[] = [];
    let entries;
    try {
      await this.#safeDirectory(directory, false);
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push("motion study directory could not be inspected safely");
      return warnings;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && z.uuid().safeParse(entry.name).success) {
        warnings.push(...await this.removeClip(referenceId, entry.name));
      } else {
        warnings.push("motion study directory contains unmanaged entries");
      }
    }
    await rmdir(directory).catch(() => undefined);
    return warnings;
  }

  public async openMedia(referenceId: string, clipId: string, kind: MotionMediaKind): Promise<OpenMotionFile> {
    const { name, contentType } = mediaFiles[kind];
    return this.#open(referenceId, clipId, name, contentType);
  }

  public async openIndexed(referenceId: string, clipId: string, kind: "keyframe" | "burst", index: number): Promise<OpenMotionFile> {
    const name = kind === "keyframe" ? keyframeFileName(index) : burstFileName(index);
    return this.#open(referenceId, clipId, name, "image/webp");
  }

  async #open(referenceId: string, clipId: string, name: string, contentType: string): Promise<OpenMotionFile> {
    const path = await this.existingPath(referenceId, clipId, name);
    const before = await lstat(path);
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      const canonical = relative(await realpath(this.#root), await realpath(path));
      if (!stat.isFile() || stat.size === 0 || stat.dev !== before.dev || stat.ino !== before.ino ||
          canonical.startsWith("..") || isAbsolute(canonical)) {
        throw new Error("Motion file changed while opening or is not a regular file");
      }
      const validator = createHash("sha256")
        .update([referenceId, clipId, name, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":")).digest("hex");
      return { file, contentType, size: stat.size, etag: `W/"${validator}"` };
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async #listClip(referenceId: string, clipId: string): Promise<string[]> {
    const directory = this.#clipDirectory(referenceId, clipId);
    await this.#safeDirectory(directory, false);
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && motionFileNamePattern.test(entry.name))
      .map((entry) => entry.name);
  }

  #clipDirectory(referenceId: string, clipId: string): string {
    z.uuid().parse(referenceId);
    z.uuid().parse(clipId);
    return resolve(this.#root, "motion", referenceId, clipId);
  }

  #validate(referenceId: string, clipId: string, name: string): void {
    z.uuid().parse(referenceId);
    z.uuid().parse(clipId);
    if (!motionFileNamePattern.test(name)) throw new Error("Motion file name is not managed");
  }

  async #safeDirectory(directory: string, create: boolean): Promise<void> {
    const fromRoot = relative(this.#root, directory);
    const parts = fromRoot.split(/[\\/]/u).filter(Boolean);
    if (isAbsolute(fromRoot) || parts.includes("..") || parts[0] !== "motion") throw new Error("Unsafe motion directory");
    if (create) await mkdir(this.#root, { recursive: true });
    const rootEntry = await lstat(this.#root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error("Storage root must be a real directory");
    let current = this.#root;
    for (const part of parts) {
      current = resolve(current, part);
      if (create) await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Motion directories must be real directories inside the storage root");
    }
  }
}
