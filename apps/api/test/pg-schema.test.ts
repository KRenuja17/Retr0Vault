import { randomUUID } from "node:crypto";

import { eq, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openPglite, rowsOf, type DatabaseConnection } from "../src/database/connection.js";
import {
  designTypes,
  motionClips,
  motionStudies,
  referenceTags,
  references,
  tags,
} from "../src/database/schema.js";

/*
 * Phase C1: the Postgres schema, applied by its migrations to an in-process
 * PGlite database. These tests hold the constraints the SQLite schema enforced
 * (with CHECKs and, for JSON, triggers) to the same standard on Postgres.
 */

let connection: DatabaseConnection;
const designTypeId = "10000000-0000-4000-8000-000000000001";

function reference(overrides: Partial<typeof references.$inferInsert> = {}): typeof references.$inferInsert {
  const id = randomUUID();
  return {
    id,
    title: "Plate",
    sourceType: "image",
    originalPath: `originals/${id}.png`,
    thumbnailPath: `thumbnails/${id}.webp`,
    imageWidth: 1920,
    imageHeight: 1080,
    imageFormat: "png",
    ...overrides,
  };
}

/** The Postgres error code of a rejected statement (drizzle wraps the driver error). */
async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    let candidate: unknown = error;
    while (candidate && typeof candidate === "object") {
      if ("code" in candidate && typeof candidate.code === "string") return candidate.code;
      candidate = "cause" in candidate ? candidate.cause : undefined;
    }
    return "unknown";
  }
  return undefined;
}

beforeAll(async () => {
  connection = await openPglite();
  await connection.migrate();
  await connection.database.insert(designTypes).values({
    id: designTypeId, slug: "print-tech-paper", name: "Print-Tech Paper", description: "d",
    deployFor: "f", risk: "r", briefBlock: "b", sortOrder: 0,
  });
}, 60_000);

afterAll(async () => {
  await connection?.close();
});

describe("the Postgres schema", () => {
  it("creates every Retr0Vault table", async () => {
    const result = await connection.database.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
    const names = (result as unknown as { rows: Array<{ table_name: string }> }).rows.map((row) => row.table_name);
    expect(names).toEqual([
      "app_metadata", "collection_references", "collections", "design_type_rules", "design_type_vocabulary",
      "design_types", "motion_clips", "motion_keyframes", "motion_search", "motion_studies", "motion_study_tags",
      "reference_frames", "reference_search", "reference_tags", "references", "sessions", "tags", "users",
    ]);
  });

  it("round-trips uuids, timestamps, booleans and jsonb documents", async () => {
    const row = reference({ designTypeId, analysisJson: { palette: ["bone"], depth: { nested: true } }, protectedFields: ["title", "tags"] });
    await connection.database.insert(references).values(row);
    const [stored] = await connection.database.select().from(references).where(eq(references.id, row.id));
    expect(stored).toMatchObject({ id: row.id, designTypeId, analysisJson: { palette: ["bone"], depth: { nested: true } }, protectedFields: ["title", "tags"], analysisStatus: "pending" });
    expect(stored!.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(stored!.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("defaults protected fields to an empty list", async () => {
    const row = reference();
    await connection.database.insert(references).values(row);
    const [stored] = await connection.database.select({ protectedFields: references.protectedFields }).from(references).where(eq(references.id, row.id));
    expect(stored!.protectedFields).toEqual([]);
  });

  it("rejects protected-field lists that name unknown fields, repeat a field or are not arrays", async () => {
    for (const protectedFields of [["title", "colour"], ["title", "title"], { title: true }, [1], Array(11).fill("title")]) {
      expect(await rejectionCode(connection.database.insert(references).values(reference({ protectedFields })))).toBe("23514");
    }
  });

  it("rejects analysis JSON that is not an object, and the other CHECKs still hold", async () => {
    expect(await rejectionCode(connection.database.insert(references).values(reference({ analysisJson: ["not", "an", "object"] })))).toBe("23514");
    expect(await rejectionCode(connection.database.insert(references).values(reference({ title: "   " })))).toBe("23514");
    expect(await rejectionCode(connection.database.insert(references).values(reference({ imageWidth: 0 })))).toBe("23514");
    // An unknown design type is a foreign-key violation, not a silent null.
    expect(await rejectionCode(connection.database.insert(references).values(reference({ designTypeId: randomUUID() })))).toBe("23503");
  });

  it("guards motion studies and clips as the SQLite schema did", async () => {
    const ref = reference();
    await connection.database.insert(references).values(ref);
    const studyId = randomUUID();
    expect(await rejectionCode(connection.database.insert(motionStudies).values({ id: studyId, referenceId: ref.id, protectedFields: ["motionDNA", "title"] }))).toBe("23514");
    expect(await rejectionCode(connection.database.insert(motionStudies).values({ id: studyId, referenceId: ref.id, beatsJson: { not: "an array" } }))).toBe("23514");
    await connection.database.insert(motionStudies).values({ id: studyId, referenceId: ref.id, protectedFields: ["motionDNA", "techniques"] });

    // A clip cannot be marked ready without its measurements and evidence.
    expect(await rejectionCode(connection.database.insert(motionClips).values({ id: randomUUID(), motionStudyId: studyId, label: "Hero", sortOrder: 0, processingStatus: "ready" }))).toBe("23514");
    await connection.database.insert(motionClips).values({
      id: randomUUID(), motionStudyId: studyId, label: "Hero", sortOrder: 0, processingStatus: "ready",
      durationMs: 1000, width: 1920, height: 1080, fps: 59.94, bytes: 3_000_000_000, evidenceJson: { events: [] },
    });
    const [clip] = await connection.database.select().from(motionClips).where(eq(motionClips.motionStudyId, studyId));
    expect(clip).toMatchObject({ fps: 59.94, bytes: 3_000_000_000, evidenceJson: { events: [] } });
  });

  it("cascades a deleted reference to its tag links and motion study", async () => {
    const ref = reference();
    await connection.database.insert(references).values(ref);
    const tagId = randomUUID();
    await connection.database.insert(tags).values({ id: tagId, type: "palette", value: "Bone", normalizedValue: "bone" });
    await connection.database.insert(referenceTags).values({ referenceId: ref.id, tagId, sortOrder: 0 });
    await connection.database.insert(motionStudies).values({ id: randomUUID(), referenceId: ref.id });

    await connection.database.delete(references).where(eq(references.id, ref.id));

    expect(await connection.database.select().from(referenceTags).where(eq(referenceTags.referenceId, ref.id))).toEqual([]);
    expect(await connection.database.select().from(motionStudies).where(eq(motionStudies.referenceId, ref.id))).toEqual([]);
    // The tag itself remains; unused tags are collected by the service, as before.
    expect(await connection.database.select().from(tags).where(eq(tags.id, tagId))).toHaveLength(1);
  });

  it("refuses to delete a design type that references still use", async () => {
    await connection.database.insert(references).values(reference({ designTypeId }));
    expect(await rejectionCode(connection.database.delete(designTypes).where(eq(designTypes.id, designTypeId)))).toBe("23503");
  });

  it("hides every table from roles other than the owner (Supabase's anon and authenticated)", async () => {
    const tables = (await connection.database.execute<{ name: string; secured: boolean }>(sql`
      select c.relname as name, c.relrowsecurity as secured from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`) as unknown as { rows: Array<{ name: string; secured: boolean }> }).rows;
    expect(tables.length).toBeGreaterThanOrEqual(16);
    expect(tables.filter((table) => !table.secured)).toEqual([]);

    await connection.database.insert(references).values(reference({ title: "Private" }));
    await connection.database.execute(sql`create role rls_probe`);
    try {
      await connection.database.execute(sql`grant select, insert on "references", reference_search to rls_probe`);
      const asProbe = (query: SQL) => connection.database.transaction(async (transaction) => {
        await transaction.execute(sql`set local role rls_probe`);
        return rowsOf(await transaction.execute(query));
      });
      expect(await asProbe(sql`select count(*)::int as count from "references"`)).toEqual([{ count: 0 }]);
      expect(await asProbe(sql`select count(*)::int as count from reference_search`)).toEqual([{ count: 0 }]);
      expect(await rejectionCode(asProbe(sql`insert into "references" (id, title, source_type, original_path, thumbnail_path,
        image_width, image_height, image_format) values (gen_random_uuid(), 'Injected', 'image', 'a.png', 'a.webp', 1, 1, 'png')`))).toBe("42501");
    } finally {
      await connection.database.execute(sql`drop owned by rls_probe`);
      await connection.database.execute(sql`drop role rls_probe`);
    }
  });
});
