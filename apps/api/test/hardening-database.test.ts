import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultMigrationsFolder, openPglite, type DatabaseConnection, type Db } from "../src/database/connection.js";
import { clearDevelopmentData, seedDevelopmentData } from "../src/database/seed.js";
import { developmentDesignTypes } from "../src/database/seed-data.js";
import { createDesignType, listDesignTypes } from "../src/services/design-types.js";
import { createImageReferenceRecord, getReference, updateReference } from "../src/services/references.js";
import { createTestDatabase, queryRows, validDesignTypeInput, TEST_USER } from "./helpers.js";

describe("database hardening and additive upgrades", () => {
  let directory: string;
  let database: DatabaseConnection;
  let connection: Db;
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-database-hardening-"));
    database = await createTestDatabase();
    connection = database.database;
  });
  afterEach(async () => { await database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  function createRecord(target = connection, id = randomUUID()) {
    return createImageReferenceRecord(target, id, { title: "Persistedword" }, {
      originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`, width: 2, height: 2, format: "png",
    }, TEST_USER.id);
  }
  /** A database migrated only as far as the baseline, before 0001_json_guards. */
  async function baselineConnection() {
    const folder = join(directory, "previous-migrations"); mkdirSync(join(folder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(defaultMigrationsFolder, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.slice(0, 1);
    for (const entry of journal.entries) copyFileSync(join(defaultMigrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    writeFileSync(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    const legacy = await openPglite();
    await legacy.migrate(folder);
    return legacy;
  }
  const appliedMigrations = async (target: Db) =>
    (await queryRows<{ count: number }>(target, sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`))[0]?.count;

  it("enforces foreign keys and stores timestamps with their time zone", async () => {
    await expect(connection.execute(sql`INSERT INTO reference_tags (reference_id, tag_id, sort_order)
      VALUES (${randomUUID()}, ${randomUUID()}, 0)`)).rejects.toThrow();
    const record = await createRecord();
    expect(await queryRows(connection, sql`SELECT pg_typeof(created_at)::text AS type FROM "references" WHERE id = ${record.id}`))
      .toEqual([{ type: "timestamp with time zone" }]);
  });

  it.each(["[]", "null", "42", '"text"'])("rejects non-object analysis JSON %s at the database boundary", async (value) => {
    const record = await createRecord();
    await expect(connection.execute(sql`UPDATE "references" SET analysis_json = ${value}::jsonb WHERE id = ${record.id}`)).rejects.toThrow();
    expect((await getReference(connection, record.id)).analysisJson).toBeNull();
    await expect(connection.execute(sql`INSERT INTO "references" (id, title, source_type, original_path, thumbnail_path, image_width, image_height, image_format, analysis_json)
      VALUES (${randomUUID()}, 'Invalid', 'image', 'unused.png', 'unused.webp', 1, 1, 'png', ${value}::jsonb)`)).rejects.toThrow();
  });

  it("rejects malformed JSON text before it reaches a jsonb column", async () => {
    const record = await createRecord();
    await expect(connection.execute(sql`UPDATE "references" SET analysis_json = ${"broken-json"}::jsonb WHERE id = ${record.id}`)).rejects.toThrow();
    expect((await getReference(connection, record.id)).analysisJson).toBeNull();
  });

  it.each(["{}", "null", '["unknown"]', '["title","title"]', "[1]", "[null]"])("rejects invalid protected-field JSON %s", async (value) => {
    const record = await createRecord();
    await expect(connection.execute(sql`UPDATE "references" SET protected_fields = ${value}::jsonb WHERE id = ${record.id}`)).rejects.toThrow();
    expect((await getReference(connection, record.id)).protectedFields).toEqual([]);
  });

  it("refuses invalid existing JSON atomically, preserving data and migration history", async () => {
    const legacy = await baselineConnection();
    try {
      // Written as the baseline schema knew it: no owner column yet.
      const record = { id: randomUUID() };
      await legacy.database.execute(sql`INSERT INTO "references" (id, title, source_type, original_path, thumbnail_path, image_width, image_height, image_format)
        VALUES (${record.id}, 'Persistedword', 'image', ${`originals/${record.id}.png`}, ${`thumbnails/${record.id}.webp`}, 2, 2, 'png')`);
      await legacy.database.execute(sql`UPDATE "references" SET protected_fields = '["unknown"]'::jsonb WHERE id = ${record.id}`);
      const before = await queryRows(legacy.database, sql`SELECT * FROM "references"`);
      await expect(legacy.migrate()).rejects.toThrow();
      expect(await queryRows(legacy.database, sql`SELECT * FROM "references"`)).toEqual(before);
      expect(await appliedMigrations(legacy.database)).toBe(1);
      expect(await queryRows(legacy.database, sql`SELECT to_regclass('public.reference_search')::text AS name`)).toEqual([{ name: null }]);
      // An operator can repair the specific record after backing up, then retry.
      await legacy.database.execute(sql`UPDATE "references" SET protected_fields = '[]'::jsonb WHERE id = ${record.id}`);
      await legacy.migrate();
      const committed = JSON.parse(readFileSync(join(defaultMigrationsFolder, "meta/_journal.json"), "utf8")) as { entries: unknown[] };
      expect(await appliedMigrations(legacy.database)).toBe(committed.entries.length);
      expect((await getReference(legacy.database, record.id)).title).toBe("Persistedword");
    } finally { await legacy.close(); }
  });

  it("rolls back the entire seed run on a late slug conflict", async () => {
    const last = developmentDesignTypes.at(-1)!;
    await createDesignType(connection, { ...validDesignTypeInput, slug: last.slug });
    const before = await listDesignTypes(connection);
    await expect(seedDevelopmentData(connection)).rejects.toThrow(/belongs to non-seed/);
    expect(await listDesignTypes(connection)).toEqual(before);
  });

  it("rolls back all seed deletions if a later design type is in use", async () => {
    await seedDevelopmentData(connection);
    const record = await createRecord();
    await updateReference(connection, record.id, { designTypeId: developmentDesignTypes.at(-1)!.id });
    const before = await listDesignTypes(connection);
    await expect(clearDevelopmentData(connection)).rejects.toThrow();
    expect(await listDesignTypes(connection)).toEqual(before);
    expect((await getReference(connection, record.id)).designTypeId).toBe(developmentDesignTypes.at(-1)!.id);
  });
});
