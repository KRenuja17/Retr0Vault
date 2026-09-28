import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig, loadRepositoryEnvironment } from "../src/config.js";
import { BlobNotFoundError, BlobRangeError, type BlobStore } from "../src/storage/blob-store.js";
import { LocalBlobStore } from "../src/storage/local-blob-store.js";
import { S3BlobStore } from "../src/storage/s3-blob-store.js";

/*
 * The contract both stores keep. The local store runs in every test run; the
 * Backblaze B2 bucket only with RETR0VAULT_LIVE=1 (it reads the repository's
 * .env, writes under a throwaway prefix and removes everything it wrote).
 */

async function collect(iterable: AsyncIterable<{ key: string }>): Promise<string[]> {
  const keys: string[] = [];
  for await (const { key } of iterable) keys.push(key);
  return keys;
}

async function text(store: BlobStore, key: string, range?: Parameters<BlobStore["read"]>[1]) {
  const read = await store.read(key, range);
  const chunks: Buffer[] = [];
  for await (const chunk of read.body) chunks.push(chunk as Buffer);
  return { ...read, text: Buffer.concat(chunks).toString("utf8") };
}

function contract(name: string, open: () => Promise<{ store: BlobStore; prefix: string; cleanup: () => Promise<void> }>) {
  describe(`${name} blob store`, () => {
    let store: BlobStore;
    let prefix: string;
    let cleanup: () => Promise<void>;
    let scratch: string;

    beforeAll(async () => {
      ({ store, prefix, cleanup } = await open());
      scratch = mkdtempSync(join(tmpdir(), "retr0vault-blob-contract-"));
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      rmSync(scratch, { recursive: true, force: true });
    }, 60_000);

    const key = (name: string) => `${prefix}${name}`;

    it("writes, heads, reads and deletes, and deleting twice is fine", async () => {
      await store.write(key("a/one.json"), "0123456789", { contentType: "application/json" });
      const info = await store.head(key("a/one.json"));
      expect(info).toMatchObject({ size: 10 });
      expect(info!.version).not.toBe("");
      expect((await text(store, key("a/one.json"))).text).toBe("0123456789");
      expect((await store.readBuffer(key("a/one.json"))).toString()).toBe("0123456789");
      await store.delete(key("a/one.json"));
      await store.delete(key("a/one.json"));
      expect(await store.head(key("a/one.json"))).toBeUndefined();
      await expect(store.read(key("a/one.json"))).rejects.toBeInstanceOf(BlobNotFoundError);
    }, 30_000);

    it("refuses an exclusive write over an existing object and keeps it", async () => {
      await store.write(key("b/keep.json"), "first", { contentType: "application/json", exclusive: true });
      await expect(store.write(key("b/keep.json"), "second", { contentType: "application/json", exclusive: true }))
        .rejects.toMatchObject({ code: "EEXIST" });
      expect((await text(store, key("b/keep.json"))).text).toBe("first");
      // An ordinary write replaces it, and the version changes.
      const before = (await store.head(key("b/keep.json")))!.version;
      await store.write(key("b/keep.json"), "second!", { contentType: "application/json" });
      expect((await text(store, key("b/keep.json"))).text).toBe("second!");
      expect((await store.head(key("b/keep.json")))!.version).not.toBe(before);
    }, 30_000);

    it("serves byte ranges and reports the whole size", async () => {
      await store.write(key("c/range.bin"), "0123456789", { contentType: "application/octet-stream" });
      const first = await text(store, key("c/range.bin"), { start: 2, end: 5 });
      expect(first).toMatchObject({ text: "2345", size: 10, range: { start: 2, end: 5 } });
      expect(await text(store, key("c/range.bin"), { start: 7 })).toMatchObject({ text: "789", range: { start: 7, end: 9 } });
      expect(await text(store, key("c/range.bin"), { suffix: 3 })).toMatchObject({ text: "789", range: { start: 7, end: 9 } });
      expect(await text(store, key("c/range.bin"), { start: 8, end: 99 })).toMatchObject({ text: "89", range: { start: 8, end: 9 } });
      await expect(store.read(key("c/range.bin"), { start: 10 })).rejects.toMatchObject({ size: 10 });
      await expect(store.read(key("c/range.bin"), { start: 10 })).rejects.toBeInstanceOf(BlobRangeError);
    }, 30_000);

    it("copies over a target and reports a missing source", async () => {
      await store.write(key("d/from.json"), "from", { contentType: "application/json" });
      await store.write(key("d/to.json"), "old", { contentType: "application/json" });
      await store.copy(key("d/from.json"), key("d/to.json"));
      expect((await text(store, key("d/to.json"))).text).toBe("from");
      expect((await text(store, key("d/from.json"))).text).toBe("from");
      await expect(store.copy(key("d/missing.json"), key("d/other.json"))).rejects.toBeInstanceOf(BlobNotFoundError);
    }, 30_000);

    it("lists by prefix in key order", async () => {
      for (const name of ["e/2.json", "e/1.json", "e/sub/3.json", "f/4.json"]) {
        await store.write(key(name), name, { contentType: "application/json" });
      }
      expect(await collect(store.list(key("e/")))).toEqual([key("e/1.json"), key("e/2.json"), key("e/sub/3.json")]);
      expect(await collect(store.list(key("nothing-here/")))).toEqual([]);
    }, 30_000);

    it("uploads and downloads local files, never over an existing file", async () => {
      const source = join(scratch, `${randomUUID()}.bin`);
      writeFileSync(source, "file contents");
      await store.writeFile(key("g/file.bin"), source, { contentType: "application/octet-stream" });
      const destination = join(scratch, `${randomUUID()}.bin`);
      await store.download(key("g/file.bin"), destination);
      expect(readFileSync(destination, "utf8")).toBe("file contents");
      await expect(store.download(key("g/file.bin"), destination)).rejects.toThrow();
      await expect(store.download(key("g/missing.bin"), join(scratch, "missing.bin"))).rejects.toBeInstanceOf(BlobNotFoundError);
    }, 30_000);

    it("refuses keys that are not portable relative paths", async () => {
      for (const bad of ["", "/abs.json", "a/../b.json", "a//b.json", "a\\b.json", "./a.json"]) {
        await expect(store.write(bad, "x", { contentType: "application/json" })).rejects.toThrow(/portable relative path/);
      }
    });
  });
}

contract("local", async () => {
  const root = mkdtempSync(join(tmpdir(), "retr0vault-local-blobs-"));
  return {
    store: new LocalBlobStore(root),
    prefix: "contract/",
    cleanup: async () => rmSync(root, { recursive: true, force: true }),
  };
});

if (process.env["RETR0VAULT_LIVE"] === "1") {
  contract("live B2", async () => {
    loadRepositoryEnvironment();
    const config = loadConfig();
    if (config.objectStorage === undefined) throw new Error("RETR0VAULT_LIVE=1 needs the S3_* settings in .env");
    const store = new S3BlobStore(config.objectStorage);
    const prefix = `retr0vault-contract-test/${randomUUID()}/`;
    return {
      store,
      prefix,
      cleanup: async () => {
        for await (const { key } of store.list(prefix)) await store.delete(key);
        store.close();
      },
    };
  });
}
