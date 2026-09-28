import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { z } from "zod";

import { contentTypeFor, type BlobStore, type ByteRange, type RangeRequest } from "./blob-store.js";
import { locateLocally } from "./local-copy.js";

/*
 * Files of a motion clip live under the key prefix `motion/<reference-id>/<clip-id>/`.
 * Only the fixed names below are ever created, served or removed; nothing is
 * derived from user input.
 *
 * ffmpeg needs real files, so uploads and processing go through a temporary
 * folder on this PC (`createWorkspace`); only finished files reach the store.
 */

export const motionFileNamePattern =
  /^(?:source\.bin|clip\.mp4|preview\.mp4|poster\.webp|k-0(?:[01][0-9]|2[0-3])\.webp|burst-[0-3]\.webp|energy\.json|energy\.webp|regions\.webp|contact-sheet\.webp)$/u;

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

/** An opened motion file. Destroying `body` releases it. */
export interface OpenMotionFile {
  readonly body: Readable;
  readonly contentType: string;
  /** The whole file's size, even when `range` limits the body. */
  readonly size: number;
  readonly etag: string;
  readonly range?: ByteRange;
}

/** A private temporary folder on this PC for one upload or processing run. */
export interface MotionWorkspace {
  readonly directory: string;
  /** A path inside the workspace for a file name it manages. */
  path(name: string): string;
  dispose(): Promise<void>;
}

export class MotionStorage {
  readonly #blobs: BlobStore;
  readonly #workRoot: string;

  public constructor(blobs: BlobStore, workRoot: string = join(tmpdir(), "retr0vault-motion")) {
    this.#blobs = blobs;
    this.#workRoot = resolve(workRoot);
  }

  /** The storage key of a managed file, as stored in the database. */
  public relativePath(referenceId: string, clipId: string, name: string): string {
    z.uuid().parse(referenceId);
    z.uuid().parse(clipId);
    if (!motionFileNamePattern.test(name)) throw new Error("Motion file name is not managed");
    return `motion/${referenceId}/${clipId}/${name}`;
  }

  /**
   * A path on this PC where a curator can read a stored file: the file itself
   * for a local store, or a copy under `inboxDirectory/evidence`.
   */
  public async locate(referenceId: string, clipId: string, name: string, inboxDirectory: string): Promise<string> {
    const key = this.relativePath(referenceId, clipId, name);
    return locateLocally(this.#blobs, key, join(inboxDirectory, "evidence", key));
  }

  public async createWorkspace(): Promise<MotionWorkspace> {
    await mkdir(this.#workRoot, { recursive: true });
    const directory = await mkdtemp(join(this.#workRoot, "work-"));
    return {
      directory,
      path: (name: string) => {
        if (!/^[a-z0-9-]+(?:\.[a-z0-9]+)+$/u.test(name)) throw new Error("Workspace file name is not managed");
        return join(directory, name);
      },
      dispose: () => rm(directory, { recursive: true, force: true, maxRetries: 3 }),
    };
  }

  /** Streams an upload into a new workspace file; the caller disposes the workspace. */
  public async receiveUpload(workspace: MotionWorkspace, stream: Readable): Promise<string> {
    const path = workspace.path(`${randomUUID()}.bin`);
    try {
      await pipeline(stream, createWriteStream(path, { flags: "wx" }));
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
    return path;
  }

  /** Stores a local file under a managed name. `source.bin` is never overwritten. */
  public async storeFile(referenceId: string, clipId: string, name: string, path: string): Promise<void> {
    const key = this.relativePath(referenceId, clipId, name);
    await this.#blobs.writeFile(key, path, { contentType: contentTypeFor(key), exclusive: name === "source.bin" });
  }

  public async writeFile(referenceId: string, clipId: string, name: string, contents: Buffer | string): Promise<void> {
    const key = this.relativePath(referenceId, clipId, name);
    await this.#blobs.write(key, contents, { contentType: contentTypeFor(key) });
  }

  /** Saves a stored file to a new local file (for ffmpeg input or a curator inbox). */
  public async download(referenceId: string, clipId: string, name: string, destination: string): Promise<void> {
    await this.#blobs.download(this.relativePath(referenceId, clipId, name), destination);
  }

  public async readText(referenceId: string, clipId: string, name: string): Promise<string> {
    return (await this.#blobs.readBuffer(this.relativePath(referenceId, clipId, name))).toString("utf8");
  }

  public async exists(referenceId: string, clipId: string, name: string): Promise<boolean> {
    return (await this.#blobs.head(this.relativePath(referenceId, clipId, name))) !== undefined;
  }

  public async removeFile(referenceId: string, clipId: string, name: string): Promise<void> {
    await this.#blobs.delete(this.relativePath(referenceId, clipId, name));
  }

  /** Removes every generated file of a clip, keeping `source.bin` for a retry. */
  public async clearGenerated(referenceId: string, clipId: string): Promise<void> {
    for (const name of await this.#listClip(referenceId, clipId)) {
      if (name !== "source.bin") await this.removeFile(referenceId, clipId, name);
    }
  }

  /** Removes a clip's managed files. Unknown files are left and reported. */
  public async removeClip(referenceId: string, clipId: string): Promise<string[]> {
    const warnings: string[] = [];
    try {
      const prefix = `${this.#clipPrefix(referenceId, clipId)}`;
      let unmanaged = false;
      for await (const object of this.#blobs.list(prefix)) {
        const name = object.key.slice(prefix.length);
        if (motionFileNamePattern.test(name)) await this.#blobs.delete(object.key);
        else unmanaged = true;
      }
      if (unmanaged) warnings.push("motion clip directory still contains unmanaged files");
    } catch {
      warnings.push("motion clip files could not be removed safely");
    }
    return warnings;
  }

  /** Removes every clip of a study. */
  public async removeStudy(referenceId: string): Promise<string[]> {
    z.uuid().parse(referenceId);
    const prefix = `motion/${referenceId}/`;
    const warnings: string[] = [];
    const clips = new Set<string>();
    try {
      for await (const object of this.#blobs.list(prefix)) {
        const [clipId, ...rest] = object.key.slice(prefix.length).split("/");
        if (clipId !== undefined && rest.length > 0 && z.uuid().safeParse(clipId).success) clips.add(clipId);
        else warnings.push("motion study directory contains unmanaged entries");
      }
    } catch {
      warnings.push("motion study directory could not be inspected safely");
      return warnings;
    }
    for (const clipId of clips) warnings.push(...await this.removeClip(referenceId, clipId));
    return warnings;
  }

  public async openMedia(referenceId: string, clipId: string, kind: MotionMediaKind, range?: RangeRequest): Promise<OpenMotionFile> {
    const { name, contentType } = mediaFiles[kind];
    return this.#open(referenceId, clipId, name, contentType, range);
  }

  public async openIndexed(referenceId: string, clipId: string, kind: "keyframe" | "burst", index: number): Promise<OpenMotionFile> {
    const name = kind === "keyframe" ? keyframeFileName(index) : burstFileName(index);
    return this.#open(referenceId, clipId, name, "image/webp");
  }

  async #open(referenceId: string, clipId: string, name: string, contentType: string, range?: RangeRequest): Promise<OpenMotionFile> {
    const read = await this.#blobs.read(this.relativePath(referenceId, clipId, name), range);
    if (read.size === 0) {
      read.body.destroy();
      throw new Error("Motion file is empty");
    }
    const validator = createHash("sha256").update([referenceId, clipId, name, read.version].join(":")).digest("hex");
    return {
      body: read.body, contentType, size: read.size, etag: `W/"${validator}"`,
      ...(read.range === undefined ? {} : { range: read.range }),
    };
  }

  async #listClip(referenceId: string, clipId: string): Promise<string[]> {
    const prefix = this.#clipPrefix(referenceId, clipId);
    const names: string[] = [];
    for await (const object of this.#blobs.list(prefix)) {
      const name = object.key.slice(prefix.length);
      if (motionFileNamePattern.test(name)) names.push(name);
    }
    return names;
  }

  #clipPrefix(referenceId: string, clipId: string): string {
    z.uuid().parse(referenceId);
    z.uuid().parse(clipId);
    return `motion/${referenceId}/${clipId}/`;
  }
}
