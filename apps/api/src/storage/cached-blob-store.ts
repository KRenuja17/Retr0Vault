import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BlobNotFoundError,
  isBlobNotFound,
  type BlobInfo,
  type BlobListing,
  type BlobRead,
  type BlobStore,
  type RangeRequest,
  type WriteOptions,
} from "./blob-store.js";
import { LocalBlobStore } from "./local-blob-store.js";

/*
 * A copy of the bucket's files on this PC, in front of the bucket. The bucket
 * is far away (each request to it takes about half a second or more from
 * here), while a plate, poster or keyframe is read again and again.
 *
 * - Writes go to the bucket first, then into the cache: nothing is cached that
 *   the bucket did not accept.
 * - Reads come from the cache; a miss fetches the file into it. A range read
 *   of a large file that is not cached yet (a video being scrubbed for the
 *   first time) goes straight to the bucket while the file is fetched behind it.
 * - Every write and delete of this archive goes through Retr0Vault, so a
 *   cached file stays current without asking the bucket.
 * - The least recently read files are dropped once the cache outgrows its limit.
 *
 * Versions are the bucket's ETags: for a single-part upload, the quoted MD5
 * of the bytes, which the cache computes itself when it writes through.
 */

interface CacheMeta {
  readonly version: string;
  readonly size: number;
  readonly lastModified: number;
}

const metaKey = (key: string) => {
  const slash = key.lastIndexOf("/");
  return `${key.slice(0, slash + 1)}.${key.slice(slash + 1)}.meta`;
};
const isMetaKey = (key: string) => /(?:^|\/)\.[^/]+\.meta$/u.test(key);

async function md5File(path: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface CachedBlobStoreOptions {
  /** Drop the least recently read files beyond this many bytes. */
  readonly maxBytes: number;
  /** A full read of a larger uncached file streams from the bucket while the cache fills. */
  readonly fillBeforeServingBytes?: number;
}

export class CachedBlobStore implements BlobStore {
  readonly #inner: BlobStore;
  readonly #cache: LocalBlobStore;
  readonly #maxBytes: number;
  readonly #fillBeforeServing: number;
  readonly #filling = new Map<string, Promise<BlobInfo | undefined>>();
  #pruning: Promise<void> | undefined;

  public constructor(inner: BlobStore, cacheRoot: string, options: CachedBlobStoreOptions) {
    this.#inner = inner;
    this.#cache = new LocalBlobStore(cacheRoot);
    this.#maxBytes = options.maxBytes;
    this.#fillBeforeServing = options.fillBeforeServingBytes ?? 16 * 1_024 * 1_024;
  }

  public get description(): string {
    return `${this.#inner.description}, cached in ${this.#cache.root}`;
  }

  public async head(key: string): Promise<BlobInfo | undefined> {
    return (await this.#cached(key)) ?? this.#inner.head(key);
  }

  public async read(key: string, range?: RangeRequest): Promise<BlobRead> {
    let info = await this.#cached(key);
    if (info === undefined) {
      const remote = await this.#inner.head(key);
      if (remote === undefined) throw new BlobNotFoundError(key);
      if (range !== undefined || remote.size > this.#fillBeforeServing) {
        this.#fillInBackground(key, remote);
        return this.#inner.read(key, range);
      }
      info = await this.#fill(key, remote);
      if (info === undefined) return this.#inner.read(key, range);
    }
    let local: BlobRead;
    try {
      local = await this.#cache.read(key, range);
    } catch (error) {
      // Dropped from the cache a moment ago: the bucket still has it.
      if (isBlobNotFound(error)) return this.#inner.read(key, range);
      throw error;
    }
    void this.#touch(key);
    return { ...local, version: info.version, lastModified: info.lastModified };
  }

  public async readBuffer(key: string): Promise<Buffer> {
    const { body } = await this.read(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  public async write(key: string, body: Buffer | string, options: WriteOptions): Promise<void> {
    await this.#inner.write(key, body, options);
    const bytes = typeof body === "string" ? Buffer.from(body) : body;
    await this.#remember(key, () => this.#cache.write(key, bytes, { contentType: options.contentType }),
      `"${createHash("md5").update(bytes).digest("hex")}"`, bytes.length);
  }

  public async writeFile(key: string, path: string, options: WriteOptions): Promise<void> {
    await this.#inner.writeFile(key, path, options);
    const md5 = await md5File(path);
    const { size } = await stat(path);
    await this.#remember(key, () => this.#cache.writeFile(key, path, { contentType: options.contentType }), `"${md5}"`, size);
  }

  public async download(key: string, path: string): Promise<void> {
    const info = (await this.#cached(key)) ?? await this.#fill(key);
    if (info === undefined) {
      await this.#inner.download(key, path);
      return;
    }
    await this.#cache.download(key, path);
  }

  public async copy(from: string, to: string): Promise<void> {
    await this.#inner.copy(from, to);
    const source = await this.#cached(from);
    if (source === undefined) {
      await this.#forget(to);
      return;
    }
    await this.#remember(to, () => this.#cache.copy(from, to), source.version, source.size);
  }

  public async delete(key: string): Promise<void> {
    await this.#inner.delete(key);
    await this.#forget(key);
  }

  public list(prefix: string): AsyncIterable<BlobListing> {
    return this.#inner.list(prefix);
  }

  public close(): void {
    this.#inner.close?.();
  }

  /** The cached file's details, if it is cached and whole. */
  async #cached(key: string): Promise<BlobInfo | undefined> {
    try {
      const meta = JSON.parse((await this.#cache.readBuffer(metaKey(key))).toString("utf8")) as CacheMeta;
      const file = await this.#cache.head(key);
      if (file === undefined || file.size !== meta.size) return undefined;
      return { size: meta.size, version: meta.version, lastModified: new Date(meta.lastModified) };
    } catch {
      return undefined;
    }
  }

  /** Fetches a file into the cache once, however many readers ask for it at the same time. */
  #fill(key: string, known?: BlobInfo): Promise<BlobInfo | undefined> {
    const running = this.#filling.get(key);
    if (running !== undefined) return running;
    const fill = (async () => {
      const info = known ?? await this.#inner.head(key);
      if (info === undefined || info.size > this.#maxBytes) return undefined;
      // Through a temporary file, so a large recording never sits in memory.
      const directory = join(tmpdir(), "retr0vault-cache-fill");
      await mkdir(directory, { recursive: true });
      const partial = join(directory, `${randomUUID()}.part`);
      try {
        await this.#inner.download(key, partial);
        if ((await stat(partial)).size !== info.size) throw new Error("A cached copy is incomplete");
        await this.#remember(key, () => this.#cache.writeFile(key, partial, { contentType: "application/octet-stream" }),
          info.version, info.size, info.lastModified.getTime());
      } finally {
        await unlink(partial).catch(() => undefined);
      }
      return info;
    })().finally(() => this.#filling.delete(key));
    this.#filling.set(key, fill);
    return fill;
  }

  #fillInBackground(key: string, known: BlobInfo): void {
    void this.#fill(key, known).catch(() => undefined);
  }

  async #remember(key: string, store: () => Promise<void>, version: string, size: number, lastModified = Date.now()): Promise<void> {
    if (this.#maxBytes <= 0 || size > this.#maxBytes) {
      await this.#forget(key);
      return;
    }
    try {
      // Drop the old details first, so a half-written cache entry is never trusted.
      await this.#cache.delete(metaKey(key));
      await store();
      await this.#touch(key);
      const meta: CacheMeta = { version, size, lastModified };
      await this.#cache.write(metaKey(key), JSON.stringify(meta), { contentType: "application/json" });
    } catch {
      await this.#forget(key);
      return;
    }
    this.#schedulePrune();
  }

  /** Marks a file as just read: pruning drops the least recently read first. */
  async #touch(key: string): Promise<void> {
    const now = new Date();
    await this.#cache.localPath(key).then((path) => utimes(path, now, now)).catch(() => undefined);
  }

  async #forget(key: string): Promise<void> {
    await this.#cache.delete(metaKey(key)).catch(() => undefined);
    await this.#cache.delete(key).catch(() => undefined);
  }

  #schedulePrune(): void {
    this.#pruning ??= this.#prune().catch(() => undefined).finally(() => {
      this.#pruning = undefined;
    });
  }

  /** Drops the least recently read files until the cache is within 90% of its limit. */
  async #prune(): Promise<void> {
    const files: BlobListing[] = [];
    for (const prefix of ["originals/", "thumbnails/", "captures/", "motion/"]) {
      for await (const object of this.#cache.list(prefix)) if (!isMetaKey(object.key)) files.push(object);
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    if (total <= this.#maxBytes) return;
    files.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());
    for (const file of files) {
      if (total <= this.#maxBytes * 0.9) break;
      await this.#forget(file.key);
      total -= file.size;
    }
  }

  /** Waits for background fills and pruning (for tests). */
  public async settled(): Promise<void> {
    await Promise.allSettled([...this.#filling.values()]);
    await this.#pruning;
  }
}
