import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  assertBlobKey,
  blobExistsError,
  BlobNotFoundError,
  BlobRangeError,
  type BlobInfo,
  type BlobListing,
  type BlobRead,
  type BlobStore,
  type RangeRequest,
  type WriteOptions,
} from "./blob-store.js";

/*
 * A BlobStore in a private S3-compatible bucket: Backblaze B2 for Retr0Vault.
 * The bucket is never public; files reach the browser only through the API.
 */

export interface S3BlobStoreConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } } | undefined;
  return candidate?.name === "NotFound" || candidate?.name === "NoSuchKey" || candidate?.$metadata?.httpStatusCode === 404;
}

/** The served bytes and total size from a `Content-Range: bytes 0-99/1234` header. */
function parseContentRange(header: string | undefined): { start: number; end: number; size: number } | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(header ?? "");
  return match === null ? undefined : { start: Number(match[1]), end: Number(match[2]), size: Number(match[3]) };
}

function rangeHeader(range: RangeRequest): string {
  return "suffix" in range ? `bytes=-${range.suffix}` : `bytes=${range.start}-${range.end ?? ""}`;
}

export class S3BlobStore implements BlobStore {
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #host: string;

  public constructor(config: S3BlobStoreConfig) {
    this.#bucket = config.bucket;
    this.#host = new URL(config.endpoint).host;
    this.#client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
      // Checksums only where S3 requires them: B2 does not need the SDK's extras,
      // and hashing a 300 MB recording twice buys nothing.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  public get description(): string {
    return `bucket ${this.#bucket} at ${this.#host}`;
  }

  public async head(key: string): Promise<BlobInfo | undefined> {
    assertBlobKey(key);
    try {
      const result = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return {
        size: result.ContentLength ?? 0,
        version: result.ETag ?? "",
        lastModified: result.LastModified ?? new Date(0),
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  public async read(key: string, range?: RangeRequest): Promise<BlobRead> {
    assertBlobKey(key);
    try {
      const result = await this.#client.send(new GetObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        ...(range === undefined ? {} : { Range: rangeHeader(range) }),
      }));
      if (!(result.Body instanceof Readable)) throw new Error("The bucket returned no readable body");
      const served = parseContentRange(result.ContentRange);
      return {
        body: result.Body,
        size: served?.size ?? result.ContentLength ?? 0,
        version: result.ETag ?? "",
        lastModified: result.LastModified ?? new Date(0),
        ...(range === undefined || served === undefined ? {} : { range: { start: served.start, end: served.end } }),
      };
    } catch (error) {
      if (isNotFound(error)) throw new BlobNotFoundError(key);
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416) {
        throw new BlobRangeError((await this.head(key))?.size ?? 0);
      }
      throw error;
    }
  }

  public async readBuffer(key: string): Promise<Buffer> {
    const { body } = await this.read(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  public async write(key: string, body: Buffer | string, options: WriteOptions): Promise<void> {
    assertBlobKey(key);
    if (options.exclusive === true && await this.head(key) !== undefined) throw blobExistsError(key);
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket, Key: key, Body: body, ContentType: options.contentType,
      ContentLength: Buffer.byteLength(body),
    }));
  }

  public async writeFile(key: string, path: string, options: WriteOptions): Promise<void> {
    assertBlobKey(key);
    if (options.exclusive === true && await this.head(key) !== undefined) throw blobExistsError(key);
    const { size } = await stat(path);
    // The SDK cannot replay a streamed body, so a dropped connection is retried
    // here, each time with a fresh stream from the file.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.#client.send(new PutObjectCommand({
          Bucket: this.#bucket, Key: key, Body: createReadStream(path), ContentType: options.contentType,
          ContentLength: size,
        }));
        return;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (attempt >= 3 || (status !== undefined && status < 500 && status !== 408 && status !== 429)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      }
    }
  }

  public async download(key: string, path: string): Promise<void> {
    const { body } = await this.read(key);
    await pipeline(body, createWriteStream(path, { flags: "wx" }));
  }

  public async copy(from: string, to: string): Promise<void> {
    assertBlobKey(from);
    assertBlobKey(to);
    try {
      await this.#client.send(new CopyObjectCommand({
        Bucket: this.#bucket, Key: to, CopySource: `${this.#bucket}/${encodeURI(from)}`,
      }));
    } catch (error) {
      if (isNotFound(error)) throw new BlobNotFoundError(from);
      throw error;
    }
  }

  public async delete(key: string): Promise<void> {
    assertBlobKey(key);
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  public async *list(prefix: string): AsyncIterable<BlobListing> {
    let continuationToken: string | undefined;
    do {
      const page = await this.#client.send(new ListObjectsV2Command({
        Bucket: this.#bucket, Prefix: prefix,
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
      }));
      for (const object of page.Contents ?? []) {
        if (object.Key === undefined) continue;
        yield { key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified ?? new Date(0) };
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
  }

  public close(): void {
    this.#client.destroy();
  }
}
