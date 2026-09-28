import type { AppConfig } from "../config.js";
import type { BlobStore } from "./blob-store.js";
import { LocalBlobStore } from "./local-blob-store.js";
import { S3BlobStore } from "./s3-blob-store.js";

/** The configured bucket, or the local storage folder when no bucket is configured. */
export function openBlobStore(config: Pick<AppConfig, "objectStorage" | "storageRoot">): BlobStore {
  return config.objectStorage === undefined ? new LocalBlobStore(config.storageRoot) : new S3BlobStore(config.objectStorage);
}
