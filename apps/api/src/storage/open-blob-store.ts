import type { AppConfig } from "../config.js";
import type { BlobStore } from "./blob-store.js";
import { CachedBlobStore } from "./cached-blob-store.js";
import { LocalBlobStore } from "./local-blob-store.js";
import { S3BlobStore } from "./s3-blob-store.js";

/**
 * The configured bucket, read through a local cache (unless the cache is
 * turned off), or the local storage folder when no bucket is configured.
 */
export function openBlobStore(config: Pick<AppConfig, "objectStorage" | "storageRoot" | "fileCache">): BlobStore {
  if (config.objectStorage === undefined) return new LocalBlobStore(config.storageRoot);
  const bucket = new S3BlobStore(config.objectStorage);
  return config.fileCache.maxBytes === 0
    ? bucket
    : new CachedBlobStore(bucket, config.fileCache.directory, { maxBytes: config.fileCache.maxBytes });
}
