import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { BlobNotFoundError, type BlobStore } from "./blob-store.js";

/** Beside each copy: the stored object's version it was made from. */
const versionFile = (destination: string) => join(dirname(destination), `.${basename(destination)}.version`);

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * A path on this PC where local tools (a curator, ffprobe) can read a stored
 * object: the object itself when the store is a local folder, otherwise a
 * copy at `destination`. A copy is reused while it was made from the stored
 * object's current version, so repeated exports download only what changed.
 */
export async function locateLocally(blobs: BlobStore, key: string, destination: string): Promise<string> {
  if (blobs.localPath !== undefined) return blobs.localPath(key);
  const info = await blobs.head(key);
  if (info === undefined) throw new BlobNotFoundError(key);
  try {
    const existing = await lstat(destination);
    if (existing.isFile() && !existing.isSymbolicLink() && existing.size === info.size &&
        await readIfPresent(versionFile(destination)) === info.version) {
      return destination;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.${randomUUID()}.part`;
  try {
    await blobs.download(key, partial);
    if ((await stat(partial)).size !== info.size) throw new Error("A downloaded copy is incomplete");
    await rename(partial, destination);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  await writeFile(versionFile(destination), info.version);
  return destination;
}
