import type { Readable } from "node:stream";

/*
 * Where Retr0Vault keeps its files (Phase C3). Keys are the storage-relative
 * paths the database stores, such as `originals/<id>.png` or
 * `motion/<reference-id>/<clip-id>/clip.mp4`; the reference and motion
 * storages decide which keys exist, and a store only keeps bytes under them.
 *
 * Two stores implement it: `LocalBlobStore` (a folder on this PC, used by the
 * tests) and `S3BlobStore` (the private Backblaze B2 bucket, or any S3 API).
 */

export interface BlobInfo {
  readonly size: number;
  /**
   * Changes whenever the bytes under the key change. Opaque: callers derive
   * their HTTP validators from it rather than passing it through.
   */
  readonly version: string;
  readonly lastModified: Date;
}

export interface BlobListing {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

export interface ByteRange {
  /** First and last byte, both inclusive (as in an HTTP `Range`). */
  readonly start: number;
  readonly end: number;
}

/**
 * A byte range as a client asks for it, before the object's size is known:
 * from `start` (to `end`, or to the end), or the last `suffix` bytes.
 */
export type RangeRequest =
  | { readonly start: number; readonly end?: number | undefined }
  | { readonly suffix: number };

/** An open read. Destroying `body` releases whatever the store holds open. */
export interface BlobRead extends BlobInfo {
  readonly body: Readable;
  /** The bytes `body` carries, when a range was asked for; `size` stays the whole object's. */
  readonly range?: ByteRange;
}

export interface WriteOptions {
  readonly contentType: string;
  /** Refuse (with code `EEXIST`) when the key already holds an object. */
  readonly exclusive?: boolean;
}

export interface BlobStore {
  /** For logs and reports; never contains a secret. */
  readonly description: string;
  head(key: string): Promise<BlobInfo | undefined>;
  /**
   * Throws `BlobNotFoundError` for a missing key, and `BlobRangeError` when
   * the range lies outside the object.
   */
  read(key: string, range?: RangeRequest): Promise<BlobRead>;
  readBuffer(key: string): Promise<Buffer>;
  write(key: string, body: Buffer | string, options: WriteOptions): Promise<void>;
  /** Uploads a local file (its size is known, so large videos stream). */
  writeFile(key: string, path: string, options: WriteOptions): Promise<void>;
  /** Saves an object to a local file, which must not exist yet. */
  download(key: string, path: string): Promise<void>;
  /** Replaces whatever `to` held. Throws `BlobNotFoundError` when `from` is missing. */
  copy(from: string, to: string): Promise<void>;
  /** Removing a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Every object whose key starts with `prefix`, in key order. */
  list(prefix: string): AsyncIterable<BlobListing>;
  /**
   * Only for a store on this PC: the verified path of an existing object, so
   * local tools can read it in place instead of downloading a copy.
   */
  localPath?(key: string): Promise<string>;
  /** Releases network connections; the store is not used afterwards. */
  close?(): void;
}

export class BlobNotFoundError extends Error {
  public readonly code = "ENOENT";

  public constructor(key: string) {
    super(`No stored object under ${key}`);
    this.name = "BlobNotFoundError";
  }
}

export class BlobRangeError extends Error {
  public readonly size: number;

  public constructor(size: number) {
    super("The requested range lies outside the stored object");
    this.name = "BlobRangeError";
    this.size = size;
  }
}

/** The bytes a range request covers in an object of `size` bytes (RFC 9110). */
export function resolveRange(range: RangeRequest, size: number): ByteRange | "unsatisfiable" {
  if ("suffix" in range) {
    if (range.suffix <= 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - range.suffix), end: size - 1 };
  }
  const end = range.end === undefined ? size - 1 : Math.min(range.end, size - 1);
  if (range.start >= size || end < range.start) return "unsatisfiable";
  return { start: range.start, end };
}

export function isBlobNotFound(error: unknown): boolean {
  return error instanceof BlobNotFoundError ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
}

export function blobExistsError(key: string): Error {
  return Object.assign(new Error(`An object already exists under ${key}`), { code: "EEXIST" });
}

/**
 * Keys are portable relative paths: forward slashes, no empty, `.` or `..`
 * segments, no backslashes or control characters.
 */
export function assertBlobKey(key: string): void {
  if (key.length === 0 || key.length > 512 || key.startsWith("/") || key.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(key) || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Storage key must be a portable relative path");
  }
}

export const contentTypes: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".bin": "application/octet-stream",
};

export function contentTypeFor(key: string): string {
  const extension = /\.[a-z0-9]+$/u.exec(key)?.[0] ?? "";
  return contentTypes[extension] ?? "application/octet-stream";
}
