import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  assertBlobKey,
  blobExistsError,
  BlobNotFoundError,
  BlobRangeError,
  resolveRange,
  type BlobInfo,
  type BlobListing,
  type BlobRead,
  type BlobStore,
  type RangeRequest,
  type WriteOptions,
} from "./blob-store.js";

/*
 * A BlobStore in a folder on this PC: the tests' store, and the layout the
 * pre-cloud `storage/` folder already has. A key is a path under the root.
 *
 * Nothing is read, written or listed through a link: the root and every
 * directory on the way must be real directories, files are opened without
 * following links, and an opened file is checked to be the one that was
 * inspected, so a path swapped mid-request is never served.
 */

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function unlinkIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!isMissing(error)) throw error;
  });
}

export class LocalBlobStore implements BlobStore {
  readonly #root: string;

  public constructor(root: string) {
    this.#root = resolve(root);
  }

  public get description(): string {
    return `local folder ${this.#root}`;
  }

  public get root(): string {
    return this.#root;
  }

  public async head(key: string): Promise<BlobInfo | undefined> {
    const path = this.#path(key);
    try {
      await this.#safeDirectory(dirname(path), false);
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink()) return undefined;
      return this.#info(entry);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  public async read(key: string, request?: RangeRequest): Promise<BlobRead> {
    const path = this.#path(key);
    const canonical = await this.#readablePath(key, path);
    const before = await lstat(canonical);
    const file = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await file.stat();
      // Serve the verified handle, never a path reopened later: recheck the
      // directories and the file's identity after opening.
      const after = await lstat(await this.#readablePath(key, path));
      if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino ||
          stat.dev !== after.dev || stat.ino !== after.ino) {
        throw new Error("Stored file changed while opening or is not a regular file");
      }
      const range = request === undefined ? undefined : resolveRange(request, stat.size);
      if (range === "unsatisfiable") throw new BlobRangeError(stat.size);
      const body = file.createReadStream({
        autoClose: true,
        ...(range === undefined ? {} : { start: range.start, end: range.end }),
      });
      return { ...this.#info(stat), body, ...(range === undefined ? {} : { range }) };
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  public async localPath(key: string): Promise<string> {
    return this.#readablePath(key, this.#path(key));
  }

  public async readBuffer(key: string): Promise<Buffer> {
    const { body } = await this.read(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  public async write(key: string, body: Buffer | string, options: WriteOptions): Promise<void> {
    const path = this.#path(key);
    await this.#safeDirectory(dirname(path), true);
    if (options.exclusive === true) {
      await this.#writeExclusive(path, body);
      return;
    }
    const staging = `${path}.${randomUUID()}.tmp`;
    try {
      await this.#writeExclusive(staging, body);
      await rename(staging, path);
    } catch (error) {
      await unlinkIfPresent(staging).catch(() => undefined);
      throw error;
    }
  }

  public async writeFile(key: string, source: string, options: WriteOptions): Promise<void> {
    const path = this.#path(key);
    await this.#safeDirectory(dirname(path), true);
    if (options.exclusive === true) {
      await copyFile(source, path, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "EEXIST" ? blobExistsError(key) : error;
      });
      return;
    }
    const staging = `${path}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, staging, constants.COPYFILE_EXCL);
      await rename(staging, path);
    } catch (error) {
      await unlinkIfPresent(staging).catch(() => undefined);
      throw error;
    }
  }

  public async download(key: string, destination: string): Promise<void> {
    const canonical = await this.#readablePath(key, this.#path(key));
    await copyFile(canonical, destination, constants.COPYFILE_EXCL);
  }

  public async copy(from: string, to: string): Promise<void> {
    const source = await this.#readablePath(from, this.#path(from));
    await this.writeFile(to, source, { contentType: "application/octet-stream" });
  }

  public async delete(key: string): Promise<void> {
    const path = this.#path(key);
    try {
      await this.#safeDirectory(dirname(path), false);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    await unlinkIfPresent(path);
    // Tidy the per-reference and per-clip directories the key made; the
    // top-level folders (originals, captures, motion…) stay.
    let directory = dirname(path);
    while (relative(this.#root, directory).split(/[\\/]/u).filter(Boolean).length > 1) {
      try {
        await rmdir(directory);
      } catch {
        break;
      }
      directory = dirname(directory);
    }
  }

  public async *list(prefix: string): AsyncIterable<BlobListing> {
    const base = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    if (base !== "") assertBlobKey(base);
    const start = base === "" ? this.#root : this.#path(base);
    try {
      await this.#safeDirectory(start, false);
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    const found: BlobListing[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        const key = relative(this.#root, path).split(/[\\/]/u).join("/");
        if (entry.isSymbolicLink()) {
          if ((await lstat(path)).isDirectory() || entry.isDirectory()) {
            throw new Error("Storage directories must not be symbolic links");
          }
          continue; // A linked file is never listed, served or removed.
        }
        if (entry.isDirectory()) {
          if (`${key}/`.startsWith(prefix) || prefix.startsWith(`${key}/`)) await walk(path);
        } else if (entry.isFile() && key.startsWith(prefix)) {
          const stat = await lstat(path);
          found.push({ key, size: stat.size, lastModified: new Date(stat.mtimeMs) });
        }
      }
    };
    await walk(start);
    found.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    yield* found;
  }

  #info(stat: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): BlobInfo {
    const version = createHash("sha256").update([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":")).digest("hex");
    return { size: stat.size, version, lastModified: new Date(stat.mtimeMs) };
  }

  #path(key: string): string {
    assertBlobKey(key);
    const path = resolve(this.#root, key);
    const fromRoot = relative(this.#root, path);
    if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
      throw new Error("Storage key resolves outside the storage root");
    }
    return path;
  }

  /** The canonical path of a regular file inside the root, reached without links. */
  async #readablePath(key: string, path: string): Promise<string> {
    try {
      await this.#safeDirectory(dirname(path), false);
      const entry = await lstat(path);
      const canonicalRoot = await realpath(this.#root);
      const canonical = await realpath(path);
      const fromRoot = relative(canonicalRoot, canonical);
      if (!entry.isFile() || entry.isSymbolicLink() || fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
        throw new Error("Stored object is not a regular file inside the storage root");
      }
      return canonical;
    } catch (error) {
      if (isMissing(error)) throw new BlobNotFoundError(key);
      throw error;
    }
  }

  async #safeDirectory(directory: string, create: boolean): Promise<void> {
    const fromRoot = relative(this.#root, directory);
    const parts = fromRoot.split(/[\\/]/u).filter(Boolean);
    if (isAbsolute(fromRoot) || parts.includes("..")) throw new Error("Unsafe storage directory");
    if (create) await mkdir(this.#root, { recursive: true });
    const rootEntry = await lstat(this.#root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) throw new Error("Storage root must be a real directory");
    let current = this.#root;
    for (const part of parts) {
      current = resolve(current, part);
      if (create) {
        await mkdir(current).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
      }
      const entry = await lstat(current);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("Storage directories must be inside the storage root and must not be symbolic links");
      }
    }
  }

  async #writeExclusive(path: string, body: Buffer | string): Promise<void> {
    // `wx` refuses (EEXIST) an existing file or link, which is left untouched;
    // a partially written new file is removed.
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(body);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlinkIfPresent(path).catch(() => undefined);
      throw error;
    }
    await handle.close();
  }
}
