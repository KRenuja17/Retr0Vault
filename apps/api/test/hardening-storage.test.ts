import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referenceListQuerySchema } from "@retr0vault/shared";
import { createDatabaseConnection, type DatabaseConnection } from "../src/database/connection.js";
import { applyMigrations } from "../src/database/migrate.js";
import { ReferenceStorage } from "../src/storage/reference-storage.js";
import { maintainOrphanFiles, orphanGracePeriodMs } from "../src/storage/orphans.js";
import { createImageReferenceRecord, getReference, listReferences, updateReference } from "../src/services/references.js";
import { getStats } from "../src/services/stats.js";

describe("storage hardening and recovery", () => {
  let directory: string;
  let root: string;
  let connection: DatabaseConnection;
  let storage: ReferenceStorage;
  let image: Buffer;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-storage-hardening-"));
    root = join(directory, "storage");
    connection = createDatabaseConnection(join(directory, "test.db"));
    applyMigrations(connection);
    storage = new ReferenceStorage(root);
    image = await sharp({ create: { width: 16, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  });
  afterEach(() => {
    if (connection.sqlite.open) connection.sqlite.close();
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
    expect(() => maintainOrphanFiles(connection, root, true)).toThrow(/links/);
  });

  it("rejects a linked storage root and traversal reads", async () => {
    const outside = join(directory, "outside"); mkdirSync(outside);
    symlinkSync(outside, root, "junction");
    await expect(store()).rejects.toThrow(/real directory/);
    await expect(storage.getOriginalImagePath(randomUUID(), "../secret.png")).rejects.toThrow(/namespace/);
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
    createImageReferenceRecord(connection, stored.id, { title: "Live" }, stored);
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
    const report = maintainOrphanFiles(connection, root);
    expect(report.candidates.sort()).toEqual(candidates.sort());
    expect(report.quarantined).toEqual([]);
    expect(existsSync(join(root, "quarantine"))).toBe(false);
    for (const path of candidates) expect(existsSync(join(root, path))).toBe(true);
    const applied = maintainOrphanFiles(connection, root, true);
    expect(applied.quarantined.sort()).toEqual(candidates.sort());
    for (const path of candidates) {
      expect(existsSync(join(root, path))).toBe(false);
      expect(readFileSync(join(applied.quarantineDirectory!, path), "utf8")).toBe("orphan");
    }
    expect(readFileSync(join(root, stored.originalPath), "utf8")).toBe("live");
    expect(readFileSync(join(root, extraForLiveId), "utf8")).toBe("keep");
    expect(existsSync(join(root, recent))).toBe(true);
    expect(maintainOrphanFiles(connection, root, true).quarantined).toEqual([]);
    expect(getStats(connection).totalReferences).toBe(1);
  });

  it("retains any database-referenced path even if its filename uses another UUID", async () => {
    const stored = await store();
    const other = `originals/${randomUUID()}.png`;
    oldFile(other);
    createImageReferenceRecord(connection, stored.id, { title: "Legacy" }, { ...stored, originalPath: other });
    expect(maintainOrphanFiles(connection, root, true).candidates).not.toContain(other);
    expect(existsSync(join(root, other))).toBe(true);
  });

  it("fails closed on database integrity errors before moving anything", () => {
    const path = `originals/${randomUUID()}.png`; oldFile(path);
    connection.sqlite.pragma("foreign_keys = OFF");
    connection.sqlite.prepare("INSERT INTO reference_frames(id, reference_id, frame_type, image_path, sort_order) VALUES (?, ?, 'viewport', ?, 0)")
      .run(randomUUID(), randomUUID(), "bad/path");
    expect(() => maintainOrphanFiles(connection, root, true)).toThrow(/integrity check/);
    expect(existsSync(join(root, path))).toBe(true);
    expect(existsSync(join(root, "quarantine"))).toBe(false);
  });

  it("runs maintenance CLI in report mode and refuses absent databases or unknown flags", () => {
    const repository = fileURLToPath(new URL("../../../", import.meta.url));
    const path = `originals/${randomUUID()}.png`; oldFile(path);
    const run = (database: string, ...args: string[]) => spawnSync(process.execPath, [
      join(repository, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", join(repository, "tsconfig.typecheck.json"),
      join(repository, "apps/api/src/storage/orphans-cli.ts"), ...args,
    ], { cwd: repository, encoding: "utf8", timeout: 15_000, env: { ...process.env, DATABASE_PATH: database, STORAGE_ROOT: root } });
    const report = run(join(directory, "test.db"));
    expect(report.status, report.stderr).toBe(0);
    expect(JSON.parse(report.stdout)).toMatchObject({ mode: "report", candidates: [path], quarantined: [] });
    const invalid = run(join(directory, "test.db"), "--delete");
    expect(invalid.status).toBe(1);
    const absent = join(directory, "absent.db");
    expect(run(absent, "--quarantine").status).toBe(1);
    expect(existsSync(absent)).toBe(false);
    expect(existsSync(join(root, path))).toBe(true);
  }, 30_000);

  it("restores a closed database, storage and analysis directory without losing search or metadata", async () => {
    const stored = await store();
    createImageReferenceRecord(connection, stored.id, { title: "Restorableword" }, stored);
    updateReference(connection, stored.id, { designDNA: "Archivedword", analysisJson: { palette: ["ochreword"] },
      tags: [{ type: "texture", value: "grainword" }], analysisStatus: "analyzed" });
    const before = getReference(connection, stored.id);
    const totals = getStats(connection);
    const analysis = join(directory, "analysis-results"); mkdirSync(analysis);
    writeFileSync(join(analysis, "result.json"), JSON.stringify({ referenceId: stored.id }));
    connection.sqlite.close(); // Cold backup: all writers have stopped.
    const restored = join(directory, "restored"); mkdirSync(restored);
    cpSync(join(directory, "test.db"), join(restored, "vault.db"));
    cpSync(root, join(restored, "storage"), { recursive: true });
    cpSync(analysis, join(restored, "analysis-results"), { recursive: true });
    const reopened = createDatabaseConnection(join(restored, "vault.db"));
    try {
      applyMigrations(reopened);
      expect(getReference(reopened, stored.id)).toEqual(before);
      expect(getStats(reopened)).toEqual(totals);
      for (const q of ["Restorableword", "Archivedword", "ochreword", "grainword"]) {
        expect(listReferences(reopened, referenceListQuerySchema.parse({ q })).items[0]?.id).toBe(stored.id);
      }
      const safePath = await new ReferenceStorage(join(restored, "storage")).getOriginalImagePath(stored.id, stored.originalPath);
      expect(readFileSync(safePath)).toEqual(image);
      expect(readFileSync(join(restored, "storage", stored.thumbnailPath))).toEqual(readFileSync(join(root, stored.thumbnailPath)));
      expect(JSON.parse(readFileSync(join(restored, "analysis-results/result.json"), "utf8"))).toEqual({ referenceId: stored.id });
      expect(reopened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { reopened.sqlite.close(); }
  });
});
