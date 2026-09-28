import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { referenceListQuerySchema } from "@retr0vault/shared";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateArchive, type ArchiveMigrationReport } from "../src/cloud/archive-migration.js";
import { backupDatabase, mirrorFiles } from "../src/cloud/backup.js";
import type { DatabaseConnection } from "../src/database/connection.js";
import { getReference, listReferences } from "../src/services/references.js";
import { getMotionStudy } from "../src/services/motion.js";
import { LocalBlobStore } from "../src/storage/local-blob-store.js";
import { createIsolatedTestDatabase, createTestDatabase, databaseSnapshot, queryRows, remoteLike } from "./helpers.js";

const schema = readFileSync(fileURLToPath(new URL("../src/cloud/sqlite-archive-schema.sql", import.meta.url)), "utf8");

const ids = {
  designType: randomUUID(), rule: randomUUID(), term: randomUUID(), collection: randomUUID(),
  image: randomUUID(), website: randomUUID(), tag: randomUUID(), frame: randomUUID(),
  study: randomUUID(), clip: randomUUID(), keyframe: randomUUID(),
};
const created = Date.UTC(2026, 7, 1, 9, 30, 15, 250);
const updated = Date.UTC(2026, 8, 20, 18, 5, 0, 5);

describe("moving the SQLite archive to the cloud", () => {
  let directory: string;
  let sqlitePath: string;
  let source: LocalBlobStore;
  let bucketRoot: string;
  let connection: DatabaseConnection;

  function writeSource(key: string, contents: string) {
    const path = join(directory, "storage", key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-archive-"));
    sqlitePath = join(directory, "retr0vault.db");
    bucketRoot = join(directory, "bucket");
    source = new LocalBlobStore(join(directory, "storage"));
    connection = await createTestDatabase();

    const archive = new Database(sqlitePath);
    archive.exec(schema);
    const insert = (table: string, row: Record<string, unknown>) => archive.prepare(
      `insert into "${table}" (${Object.keys(row).map((key) => `"${key}"`).join(", ")}) values (${Object.keys(row).map(() => "?").join(", ")})`,
    ).run(...Object.values(row));
    insert("design_types", { id: ids.designType, slug: "print-tech", name: "Print-Tech", description: "d", deploy_for: "f", risk: "r",
      brief_block: "b", sort_order: 0, created_at: created, updated_at: updated });
    insert("design_type_rules", { id: ids.rule, design_type_id: ids.designType, kind: "principle", text: "Lead with paper", sort_order: 0 });
    insert("design_type_vocabulary", { id: ids.term, design_type_id: ids.designType, term: "risograph", sort_order: 0 });
    insert("collections", { id: ids.collection, slug: "keepers", name: "Keepers", description: "", is_pinned: 1, sort_order: 0 });
    insert("references", { id: ids.image, title: "Grainy poster", source_type: "image", original_path: `originals/${ids.image}.png`,
      thumbnail_path: `thumbnails/${ids.image}.webp`, design_type_id: ids.designType, design_dna: "ink × paper", analysis_status: "analyzed",
      analysis_json: JSON.stringify({ palette: ["ochre"] }), image_width: 640, image_height: 480, image_format: "png",
      created_at: created, updated_at: updated, protected_fields: JSON.stringify(["title", "designDNA"]) });
    insert("references", { id: ids.website, title: "Studio site", source_type: "website", source_url: "https://example.com/",
      original_path: `captures/${ids.website}/viewport.png`, thumbnail_path: `thumbnails/${ids.website}.webp`, analysis_status: "pending",
      image_width: 1440, image_height: 900, image_format: "png", created_at: created + 1, updated_at: updated, protected_fields: "[]" });
    insert("tags", { id: ids.tag, type: "texture", value: "Halftone", normalized_value: "halftone" });
    insert("reference_tags", { reference_id: ids.image, tag_id: ids.tag, sort_order: 0 });
    insert("collection_references", { collection_id: ids.collection, reference_id: ids.image, sort_order: 0 });
    insert("reference_frames", { id: ids.frame, reference_id: ids.website, frame_type: "viewport", image_path: `captures/${ids.website}/viewport.png`, sort_order: 0 });
    insert("motion_studies", { id: ids.study, reference_id: ids.website, motion_status: "pending", motion_dna: "slow drift",
      verified_tech_json: JSON.stringify([{ claim: "WebGL2", source: "devtools" }]), protected_fields: "[]", created_at: created, updated_at: updated });
    insert("motion_clips", { id: ids.clip, motion_study_id: ids.study, label: "Scroll", sort_order: 0, processing_status: "failed",
      processing_error: "ffmpeg missing", poster_ms: 1000, bytes: 12, fps: 29.97, created_at: created, updated_at: updated });
    insert("motion_keyframes", { id: ids.keyframe, motion_clip_id: ids.clip, time_ms: 0, reason: "start",
      image_path: `motion/${ids.website}/${ids.clip}/k-000.webp`, sort_order: 0 });
    insert("motion_study_tags", { motion_study_id: ids.study, type: "trigger", value: "Scroll", normalized_value: "scroll", sort_order: 0 });
    archive.close();

    writeSource(`originals/${ids.image}.png`, "original image bytes");
    writeSource(`thumbnails/${ids.image}.webp`, "thumbnail bytes");
    writeSource(`captures/${ids.website}/viewport.png`, "viewport bytes");
    writeSource(`thumbnails/${ids.website}.webp`, "website thumbnail");
    writeSource(`motion/${ids.website}/${ids.clip}/source.bin`, "recording!!!");
    writeSource(`motion/${ids.website}/${ids.clip}/k-000.webp`, "keyframe");
    // Leftovers of interrupted operations are not archive content.
    writeSource(`originals/${ids.image}.png.previous`, "old picture");
    writeSource("originals/.gitkeep", "");
  });

  afterEach(async () => {
    await connection.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  const run = (dryRun: boolean): Promise<ArchiveMigrationReport> => migrateArchive({
    sqlitePath, source, target: remoteLike(new LocalBlobStore(bucketRoot)), db: connection.database, dryRun,
  });
  const bucketFile = (key: string) => readFileSync(join(bucketRoot, key), "utf8");
  const statuses = (report: ArchiveMigrationReport) => [...new Set(report.files.map((file) => file.status))];

  it("checks everything in a dry run and keeps nothing", async () => {
    const report = await run(true);
    expect(report.ok).toBe(true);
    expect(report.tables.every((table) => table.present === table.source)).toBe(true);
    expect(report.files).toHaveLength(6);
    expect(statuses(report)).toEqual(["would-upload"]);
    expect(report.skippedFiles.sort()).toEqual(["originals/.gitkeep", `originals/${ids.image}.png.previous`]);
    expect(await queryRows(connection.database, sql`select count(*)::int as count from "references"`)).toEqual([{ count: 0 }]);
    expect(() => bucketFile(`originals/${ids.image}.png`)).toThrow();
  });

  it("copies rows with their IDs, dates, flags, protections and analyses, and the files byte for byte", async () => {
    const report = await run(false);
    expect(report.ok, JSON.stringify(report, null, 2)).toBe(true);
    expect(report.tables.find((table) => table.table === "references")).toEqual({ table: "references", source: 2, inserted: 2, present: 2 });
    expect(statuses(report)).toEqual(["uploaded"]);
    for (const file of report.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const db = connection.database;
    const image = await getReference(db, ids.image);
    expect(image).toMatchObject({
      title: "Grainy poster", designDNA: "ink × paper", analysisStatus: "analyzed", analysisJson: { palette: ["ochre"] },
      protectedFields: ["title", "designDNA"], originalPath: `originals/${ids.image}.png`,
      createdAt: new Date(created).toISOString(), updatedAt: new Date(updated).toISOString(),
    });
    expect(image.tags.map((tag) => tag.value)).toEqual(["Halftone"]);
    expect(image.collectionIds).toEqual([ids.collection]);
    expect(await queryRows(db, sql`select is_pinned as pinned from collections`)).toEqual([{ pinned: true }]);
    expect((await getReference(db, ids.website)).frames).toHaveLength(1);
    const study = await getMotionStudy(db, ids.website);
    expect(study).toMatchObject({ motionDNA: "slow drift", verifiedTech: [{ claim: "WebGL2", source: "devtools" }] });
    expect(study.clips[0]).toMatchObject({ id: ids.clip, processingStatus: "failed", fps: 29.97 });

    // Search was built for the copied rows.
    for (const q of ["grainy", "halftone", "risograph", "ochre"]) {
      expect((await listReferences(db, referenceListQuerySchema.parse({ q }))).items.map((item) => item.id)).toEqual([ids.image]);
    }
    expect(bucketFile(`originals/${ids.image}.png`)).toBe("original image bytes");
    expect(bucketFile(`motion/${ids.website}/${ids.clip}/source.bin`)).toBe("recording!!!");
  });

  it("copies only what is missing when run again, and never overwrites different bytes", async () => {
    await run(false);
    const again = await run(false);
    expect(again.ok).toBe(true);
    expect(again.tables.every((table) => table.inserted === 0 && table.present === table.source)).toBe(true);
    expect(statuses(again)).toEqual(["already-present"]);

    writeFileSync(join(bucketRoot, "thumbnails", `${ids.image}.webp`), "changed in the cloud");
    const differs = await run(false);
    expect(differs.ok).toBe(false);
    expect(differs.files.find((file) => file.key === `thumbnails/${ids.image}.webp`)).toMatchObject({ status: "differs" });
    expect(bucketFile(`thumbnails/${ids.image}.webp`)).toBe("changed in the cloud");
  });

  it("leaves Postgres as it was when a row breaks a constraint", async () => {
    const archive = new Database(sqlitePath);
    archive.prepare(`update "references" set protected_fields = '["notAField"]' where id = ?`).run(ids.website);
    archive.close();
    await expect(run(false)).rejects.toThrow();
    expect(await queryRows(connection.database, sql`select count(*)::int as count from design_types`)).toEqual([{ count: 0 }]);
  });

  it("backs up to a file that the migration restores exactly, and mirrors the bucket", async () => {
    await run(false);
    const backupPath = join(directory, "backup.db");
    const backup = await backupDatabase(connection.database, backupPath);
    expect(backup.tables.find((table) => table.table === "motion_keyframes")).toEqual({ table: "motion_keyframes", rows: 1 });
    await expect(backupDatabase(connection.database, backupPath)).rejects.toThrow(/already exists/);

    const restored = await createIsolatedTestDatabase();
    try {
      // An empty project: the backup brings its own accounts.
      await restored.database.execute(sql`delete from users`);
      const result = await migrateArchive({
        sqlitePath: backupPath, source, target: remoteLike(new LocalBlobStore(join(directory, "second-bucket"))),
        db: restored.database, dryRun: false,
      });
      expect(result.ok).toBe(true);
      expect(await databaseSnapshot(restored.database)).toEqual(await databaseSnapshot(connection.database));
    } finally {
      await restored.close();
    }

    const bucket = remoteLike(new LocalBlobStore(bucketRoot));
    const mirror = join(directory, "mirror");
    expect(await mirrorFiles(bucket, mirror)).toMatchObject({ files: 6 });
    expect(readFileSync(join(mirror, `motion/${ids.website}/${ids.clip}/source.bin`), "utf8")).toBe("recording!!!");
    expect(await mirrorFiles(bucket, mirror)).toMatchObject({ files: 6 });
  });
});
