import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referenceListQuerySchema } from "@retr0vault/shared";
import { createDatabaseConnection, type DatabaseConnection } from "../src/database/connection.js";
import { applyMigrations, defaultMigrationsFolder } from "../src/database/migrate.js";
import { clearDevelopmentData, seedDevelopmentData } from "../src/database/seed.js";
import { developmentDesignTypes } from "../src/database/seed-data.js";
import { createDesignType, listDesignTypes } from "../src/services/design-types.js";
import { createImageReferenceRecord, getReference, listReferences, updateReference } from "../src/services/references.js";
import { validDesignTypeInput } from "./helpers.js";

describe("database hardening and additive upgrades", () => {
  let directory: string;
  let connection: DatabaseConnection;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-database-hardening-"));
    connection = createDatabaseConnection(join(directory, "test.db"));
    applyMigrations(connection);
  });
  afterEach(() => { connection.sqlite.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  function createRecord(target = connection, id = randomUUID()) {
    return createImageReferenceRecord(target, id, { title: "Persistedword" }, {
      originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`, width: 2, height: 2, format: "png",
    });
  }
  function legacyConnection() {
    const folder = join(directory, "previous-migrations"); mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(defaultMigrationsFolder, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.slice(0, 6);
    for (const entry of journal.entries) copyFileSync(join(defaultMigrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    const legacy = createDatabaseConnection(join(directory, "legacy.db"));
    applyMigrations(legacy, folder);
    return legacy;
  }

  it("enables foreign keys, WAL, full durability and a bounded lock wait", () => {
    for (const [pragma, value] of [["foreign_keys", 1], ["journal_mode", "wal"], ["synchronous", 2], ["busy_timeout", 1_000]] as const) {
      expect(connection.sqlite.pragma(pragma, { simple: true })).toBe(value);
    }
  });

  it.each(["broken-json", "[]", "null", "42", '"text"'])("rejects non-object analysis JSON %s at the database boundary", (value) => {
    const record = createRecord();
    expect(() => connection.sqlite.prepare('UPDATE "references" SET analysis_json = ? WHERE id = ?').run(value, record.id)).toThrow();
    expect(getReference(connection, record.id).analysisJson).toBeNull();
    expect(() => connection.sqlite.prepare(`INSERT INTO "references" (id, title, source_type, original_path, thumbnail_path, image_width, image_height, image_format, analysis_json)
      VALUES (?, 'Invalid', 'image', 'unused.png', 'unused.webp', 1, 1, 'png', ?)`).run(randomUUID(), value)).toThrow();
  });

  it.each(["broken", "{}", "null", '["unknown"]', '["title","title"]', '[1]', '[null]'])("rejects invalid protected-field JSON %s", (value) => {
    const record = createRecord();
    expect(() => connection.sqlite.prepare('UPDATE "references" SET protected_fields = ? WHERE id = ?').run(value, record.id)).toThrow();
    expect(getReference(connection, record.id).protectedFields).toEqual([]);
  });

  it("upgrades populated image/capture data without changing rowids, relations, FTS or protections", () => {
    const legacy = legacyConnection();
    try {
      const record = createRecord(legacy);
      updateReference(legacy, record.id, { analysisJson: { palette: ["retainedword"] }, tags: [{ type: "texture", value: "grainword" }] });
      const website = createRecord(legacy);
      legacy.sqlite.prepare('UPDATE "references" SET source_type = ?, original_path = ? WHERE id = ?')
        .run("website", `captures/${website.id}/viewport.png`, website.id);
      legacy.sqlite.prepare("INSERT INTO reference_frames(id, reference_id, frame_type, image_path, sort_order) VALUES (?, ?, 'viewport', ?, 0)")
        .run(randomUUID(), website.id, `captures/${website.id}/viewport.png`);
      const before = getReference(legacy, record.id);
      const frames = getReference(legacy, website.id).frames;
      const rowids = legacy.sqlite.prepare('SELECT rowid, id FROM "references" ORDER BY id').all();
      applyMigrations(legacy); applyMigrations(legacy);
      expect(getReference(legacy, record.id)).toEqual(before);
      expect(getReference(legacy, website.id).frames).toEqual(frames);
      expect(legacy.sqlite.prepare('SELECT rowid, id FROM "references" ORDER BY id').all()).toEqual(rowids);
      for (const q of ["retainedword", "grainword"]) expect(listReferences(legacy, referenceListQuerySchema.parse({ q })).items[0]?.id).toBe(record.id);
      updateReference(legacy, record.id, { analysisJson: { palette: ["newword"] } });
      expect(listReferences(legacy, referenceListQuerySchema.parse({ q: "newword" })).total).toBe(1);
      expect(listReferences(legacy, referenceListQuerySchema.parse({ q: "retainedword" })).total).toBe(0);
      expect(legacy.sqlite.pragma("foreign_key_check")).toEqual([]);
      expect(legacy.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
      legacy.sqlite.exec("INSERT INTO reference_search(reference_search) VALUES('integrity-check')");
    } finally { legacy.sqlite.close(); }
  });

  it("refuses invalid legacy JSON atomically, preserving data and migration history", () => {
    const legacy = legacyConnection();
    try {
      const record = createRecord(legacy);
      legacy.sqlite.prepare('UPDATE "references" SET protected_fields = ? WHERE id = ?').run('["unknown"]', record.id);
      const before = legacy.sqlite.prepare('SELECT * FROM "references"').all();
      expect(() => applyMigrations(legacy)).toThrow();
      expect(legacy.sqlite.prepare('SELECT * FROM "references"').all()).toEqual(before);
      expect(legacy.sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 6 });
      expect(legacy.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'references_json_insert_guard'").get()).toBeUndefined();
      // An operator can repair the specific record after backing up, then retry.
      legacy.sqlite.prepare('UPDATE "references" SET protected_fields = ? WHERE id = ?').run("[]", record.id);
      applyMigrations(legacy);
      expect(legacy.sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get()).toEqual({ count: 7 });
    } finally { legacy.sqlite.close(); }
  });

  it("rolls back the entire seed run on a late slug conflict", () => {
    const last = developmentDesignTypes.at(-1)!;
    createDesignType(connection, { ...validDesignTypeInput, slug: last.slug });
    const before = listDesignTypes(connection);
    expect(() => seedDevelopmentData(connection)).toThrow(/belongs to non-seed/);
    expect(listDesignTypes(connection)).toEqual(before);
  });

  it("rolls back all seed deletions if a later design type is in use", () => {
    seedDevelopmentData(connection);
    const record = createRecord();
    updateReference(connection, record.id, { designTypeId: developmentDesignTypes.at(-1)!.id });
    const before = listDesignTypes(connection);
    expect(() => clearDevelopmentData(connection)).toThrow();
    expect(listDesignTypes(connection)).toEqual(before);
    expect(getReference(connection, record.id).designTypeId).toBe(developmentDesignTypes.at(-1)!.id);
  });
});
