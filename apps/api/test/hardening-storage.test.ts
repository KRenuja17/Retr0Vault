import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referenceListQuerySchema } from "@retr0vault/shared";
import { openPglite, type DatabaseConnection, type Db } from "../src/database/connection.js";
import { LocalBlobStore } from "../src/storage/local-blob-store.js";
import { ReferenceStorage } from "../src/storage/reference-storage.js";
import { maintainOrphanFiles, orphanGracePeriodMs } from "../src/storage/orphans.js";
import { createImageReferenceRecord, getReference, listReferences, updateReference } from "../src/services/references.js";
import { getStats } from "../src/services/stats.js";
import { createIsolatedTestDatabase, createTestDatabase } from "./helpers.js";

describe("storage hardening and recovery", () => {
  let directory: string;
  let root: string;
  let database: DatabaseConnection;
  let connection: Db;
  let blobs: LocalBlobStore;
  let storage: ReferenceStorage;
  let image: Buffer;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-storage-hardening-"));
    root = join(directory, "storage");
    database = await createTestDatabase();
    connection = database.database;
    blobs = new LocalBlobStore(root);
    storage = new ReferenceStorage(blobs);
    image = await sharp({ create: { width: 16, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  });
  afterEach(async () => {
    await database.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });
  async function store(id = randomUUID()) {
    return { id, ...await storage.storeImage(id, image, await storage.inspectImage(image)) };
  }
  function oldFile(path: string, text = "orphan") {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
    const old = new Date(Date.now() - orphanGracePeriodMs - 60_000);
    utimesSync(absolute, old, old);
    return absolute;
  }

  it("never overwrites or removes a thumbnail owned by an earlier operation", async () => {
    const id = randomUUID();
    const existing = oldFile(`thumbnails/${id}.webp`, "keep me");
    await expect(store(id)).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(existing, "utf8")).toBe("keep me");
    expect(existsSync(join(root, `originals/${id}.png`))).toBe(false);
  });

  it("preserves both files when the original already exists", async () => {
    const first = await store();
    const before = readFileSync(join(root, first.thumbnailPath));
    await expect(store(first.id)).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(join(root, first.originalPath))).toEqual(image);
    expect(readFileSync(join(root, first.thumbnailPath))).toEqual(before);
  });

  it.each(["originals", "thumbnails"])("rejects a linked %s directory without touching its target", async (kind) => {
    const outside = join(directory, "outside");
    mkdirSync(outside); mkdirSync(root);
    writeFileSync(join(outside, "sentinel"), "unchanged");
    symlinkSync(outside, join(root, kind), "junction");
    await expect(store()).rejects.toThrow(/symbolic link/);
    expect(readdirSync(outside)).toEqual(["sentinel"]);
    await expect(maintainOrphanFiles(connection, blobs, true)).rejects.toThrow(/links/);
  });

  it("rejects a linked storage root and traversal reads", async () => {
    const outside = join(directory, "outside"); mkdirSync(outside);
    symlinkSync(outside, root, "junction");
    await expect(store()).rejects.toThrow(/real directory/);
    await expect(storage.locateOriginalImage(randomUUID(), "../secret.png", join(directory, "inbox"))).rejects.toThrow(/namespace/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("handles repeated file cleanup as an idempotent operation", async () => {
    const stored = await store();
    expect(await storage.deleteReferenceFiles(stored.id, stored.originalPath, stored.thumbnailPath)).toEqual({ warnings: [] });
    expect(await storage.deleteReferenceFiles(stored.id, stored.originalPath, stored.thumbnailPath)).toEqual({ warnings: [] });
    expect(await storage.deleteReferenceFiles(randomUUID(), `captures/${randomUUID()}/viewport.png`, "../outside")).toHaveProperty("warnings.length", 2);
  });

  it("reports only old, recognized, unowned files and quarantines them recoverably", async () => {
    const stored = await store();
    await createImageReferenceRecord(connection, stored.id, { title: "Live" }, stored);
    oldFile(stored.originalPath, "live");
    const orphanId = randomUUID();
    const captureId = randomUUID();
    const candidates = [`originals/${orphanId}.png`, `thumbnails/${orphanId}.webp`, `captures/${captureId}/viewport.png`, `captures/${captureId}/scroll-50.png`];
    for (const path of candidates) oldFile(path);
    oldFile("originals/unrecognized.png", "keep");
    oldFile(`captures/${captureId}/notes.txt`, "keep");
    const recent = `originals/${randomUUID()}.png`;
    writeFileSync(join(root, recent), "recent");
    const extraForLiveId = `originals/${stored.id}.jpg`;
    oldFile(extraForLiveId, "keep");
    const report = await maintainOrphanFiles(connection, blobs);
    expect(report.candidates.sort()).toEqual(candidates.sort());
    expect(report.quarantined).toEqual([]);
    expect(existsSync(join(root, "quarantine"))).toBe(false);
    for (const path of candidates) expect(existsSync(join(root, path))).toBe(true);
    const applied = await maintainOrphanFiles(connection, blobs, true);
    expect(applied.quarantined.sort()).toEqual(candidates.sort());
    for (const path of candidates) {
      expect(existsSync(join(root, path))).toBe(false);
      expect(readFileSync(join(root, applied.quarantinePrefix!, path), "utf8")).toBe("orphan");
    }
    expect(readFileSync(join(root, stored.originalPath), "utf8")).toBe("live");
    expect(readFileSync(join(root, extraForLiveId), "utf8")).toBe("keep");
    expect(existsSync(join(root, recent))).toBe(true);
    expect((await maintainOrphanFiles(connection, blobs, true)).quarantined).toEqual([]);
    expect((await getStats(connection)).totalReferences).toBe(1);
  });

  it("retains any database-referenced path even if its filename uses another UUID", async () => {
    const stored = await store();
    const other = `originals/${randomUUID()}.png`;
    oldFile(other);
    await createImageReferenceRecord(connection, stored.id, { title: "Legacy" }, { ...stored, originalPath: other });
    expect((await maintainOrphanFiles(connection, blobs, true)).candidates).not.toContain(other);
    expect(existsSync(join(root, other))).toBe(true);
  });

  it("fails closed when the catalogue cannot be read, before moving anything", async () => {
    const path = `originals/${randomUUID()}.png`; oldFile(path);
    const unavailable = await createIsolatedTestDatabase();
    await unavailable.close();
    await expect(maintainOrphanFiles(unavailable.database, blobs, true)).rejects.toThrow();
    expect(existsSync(join(root, path))).toBe(true);
    expect(existsSync(join(root, "quarantine"))).toBe(false);
  });

  it("refuses unknown flags and an unreachable database in the maintenance CLI without touching storage", () => {
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    const path = `originals/${randomUUID()}.png`; oldFile(path);
    const run = (...args: string[]) => spawnSync(process.execPath, [
      join(repository, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", join(repository, "tsconfig.typecheck.json"),
      join(repository, "apps/api/src/storage/orphans-cli.ts"), ...args,
    ], { cwd: repository, encoding: "utf8", timeout: 15_000, env: {
      // Unreachable on purpose: the repository .env never overrides what is already set.
      ...process.env, DATABASE_URL: "postgres://nobody@127.0.0.1:9/none", STORAGE_ROOT: root,
    } });
    expect(run("--delete").status).toBe(1);
    expect(run("--quarantine").status).toBe(1);
    expect(existsSync(join(root, path))).toBe(true);
    expect(existsSync(join(root, "quarantine"))).toBe(false);
  }, 30_000);

  it("restores a database backup, storage and analysis directory without losing search or metadata", async () => {
    const stored = await store();
    await createImageReferenceRecord(connection, stored.id, { title: "Restorableword" }, stored);
    await updateReference(connection, stored.id, { designDNA: "Archivedword", analysisJson: { palette: ["ochreword"] },
      tags: [{ type: "texture", value: "grainword" }], analysisStatus: "analyzed" });
    const before = await getReference(connection, stored.id);
    const totals = await getStats(connection);
    const analysis = join(directory, "analysis-results"); mkdirSync(analysis);
    writeFileSync(join(analysis, "result.json"), JSON.stringify({ referenceId: stored.id }));
    // A full database backup (in production, pg_dump of Supabase).
    const backup = await (connection as unknown as { $client: PGlite }).$client.dumpDataDir("none");
    await database.close();
    const restored = join(directory, "restored"); mkdirSync(restored);
    cpSync(root, join(restored, "storage"), { recursive: true });
    cpSync(analysis, join(restored, "analysis-results"), { recursive: true });
    const reopenedConnection = await openPglite({ loadDataDir: backup });
    const reopened = reopenedConnection.database;
    try {
      await reopenedConnection.migrate();
      expect(await getReference(reopened, stored.id)).toEqual(before);
      expect(await getStats(reopened)).toEqual(totals);
      for (const q of ["Restorableword", "Archivedword", "ochreword", "grainword"]) {
        expect((await listReferences(reopened, referenceListQuerySchema.parse({ q }))).items[0]?.id).toBe(stored.id);
      }
      const safePath = await new ReferenceStorage(new LocalBlobStore(join(restored, "storage")))
        .locateOriginalImage(stored.id, stored.originalPath, join(restored, "inbox"));
      expect(readFileSync(safePath)).toEqual(image);
      expect(readFileSync(join(restored, "storage", stored.thumbnailPath))).toEqual(readFileSync(join(root, stored.thumbnailPath)));
      expect(JSON.parse(readFileSync(join(restored, "analysis-results/result.json"), "utf8"))).toEqual({ referenceId: stored.id });
    } finally { await reopenedConnection.close(); }
  });
});
