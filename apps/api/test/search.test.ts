import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectionResponseSchema,
  designTypeResponseSchema,
  referenceListQuerySchema,
  referenceListResponseSchema,
  type UpdateReferenceInput,
} from "@retr0vault/shared";

import { defaultMigrationsFolder, openPglite, type Db } from "../src/database/connection.js";
import { references, referenceTags, tags } from "../src/database/schema.js";
import { createCollection, updateCollection } from "../src/services/collections.js";
import { createDesignType, updateDesignType } from "../src/services/design-types.js";
import {
  addReferenceToCollection, createImageReferenceRecord, deleteReferenceRecord,
  listReferences, removeReferenceFromCollection, updateReference,
} from "../src/services/references.js";
import { createTestApp, disposeTestApp, queryRows, validDesignTypeInput, type TestAppContext } from "./helpers.js";

describe("reference search and catalogue queries", () => {
  let context: TestAppContext;
  let connection: Db;

  beforeEach(async () => {
    context = await createTestApp("search");
    connection = context.db;
  });

  afterEach(async () => {
    await disposeTestApp(context);
  });

  async function createReference(title = "Neutral study", patch: UpdateReferenceInput = {}) {
    const id = randomUUID();
    const reference = await createImageReferenceRecord(connection, id, { title }, {
      originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`,
      width: 1, height: 1, format: "png",
    });
    return Object.keys(patch).length === 0 ? reference :
      await updateReference(connection, id, patch, { protectEditedFields: false });
  }

  async function list(parameters: Record<string, string> = {}) {
    const response = await context.app.inject({
      method: "GET", url: `/api/v1/references?${new URLSearchParams(parameters).toString()}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return referenceListResponseSchema.parse(response.json());
  }

  const searchableFields: Array<{ name: string; q: string; patch: UpdateReferenceInput }> = [
    { name: "title", q: "serif", patch: { title: "Large Serif Study" } },
    { name: "design DNA", q: "dark editorial", patch: { designDNA: "dark × editorial" } },
    { name: "design thesis", q: "technical mono", patch: { designThesis: "Technical labels use mono typography." } },
    { name: "tags", q: "halftone", patch: { tags: [{ type: "texture", value: "CMYK Halftone dots" }] } },
    { name: "source URL", q: "luxury automotive", patch: { sourceUrl: "https://archive.example/automotive-luxury" } },
    { name: "design brief", q: "grain", patch: { designBrief: "Use fine film grain sparingly." } },
    { name: "image recipe", q: "voxel", patch: { imageRecipe: "[SUBJECT] rendered as a voxel diorama" } },
    { name: "internal analysis", q: "orange", patch: { analysisJson: { palette: ["burnt orange"], layout: { description: "wide margins" } } } },
  ];

  it.each(searchableFields)("searches $name", async ({ q, patch }) => {
    const expected = await createReference("Target", patch);
    await createReference("Unrelated");
    const response = await list({ q });
    expect(response.total).toBe(1);
    expect(response.items.map((item) => item.id)).toEqual([expected.id]);
  });

  it("searches design-type names, slugs, descriptions and vocabulary", async () => {
    const designType = await createDesignType(connection, {
      ...validDesignTypeInput, name: "Print Tech", slug: "print-tech",
      description: "Mechanical composition", vocabulary: ["halftone", "technical mono"],
    });
    const target = await createReference("Assigned", { designTypeId: designType.id });
    await createReference("Unassigned");
    for (const q of ["Print Tech", "print-tech", "mechanical", "halftone", "technical mono"]) {
      expect((await list({ q })).items.map((item) => item.id)).toEqual([target.id]);
    }
  });

  it("requires all query words, including matches spread across fields", async () => {
    const target = await createReference("Dark study", { tags: [{ type: "layout", value: "editorial" }] });
    await createReference("Dark only");
    await createReference("Editorial only");
    expect((await list({ q: "dark editorial" })).items.map((item) => item.id)).toEqual([target.id]);
    expect((await list({ q: "dark dark editorial" })).total).toBe(1);
    expect((await list({ q: "darker" })).total).toBe(0);
  });

  it("uses weighted relevance by default while honoring explicit date/title sorting", async () => {
    const title = await createReference("grain", { designBrief: "neutral" });
    const dna = await createReference("neutral", { designDNA: "grain" });
    const brief = await createReference("neutral", { designBrief: "grain" });
    for (const [index, reference] of [title, dna, brief].entries()) {
      await connection.update(references).set({ createdAt: new Date(1_700_000_000_000 + index * 1_000) })
        .where(eq(references.id, reference.id));
    }
    expect((await list({ q: "grain" })).items.map((item) => item.id)).toEqual([title.id, dna.id, brief.id]);
    expect((await list({ q: "grain", sort: "relevance" })).items.map((item) => item.id)).toEqual([title.id, dna.id, brief.id]);
    expect((await list({ q: "grain", sort: "newest" })).items.map((item) => item.id)).toEqual([brief.id, dna.id, title.id]);
    expect((await list({ q: "grain", sort: "oldest" })).items.map((item) => item.id)).toEqual([title.id, dna.id, brief.id]);
    expect((await list({ q: "grain", sort: "title-asc" })).items[0]?.id).toBe(title.id);
    expect((await list()).items[0]?.id).toBe(brief.id);
    expect((await list({ sort: "relevance" })).items[0]?.id).toBe(brief.id);
  });

  it("combines search, type, collection and status before counting and paging", async () => {
    const designType = await createDesignType(connection, validDesignTypeInput);
    const collection = await createCollection(connection, { name: "Keepers", slug: "keepers", description: "", isPinned: false });
    const first = await createReference("Alpha grain", { designTypeId: designType.id, analysisStatus: "analyzed", collectionIds: [collection.id] });
    const second = await createReference("Bravo grain", { designTypeId: designType.id, analysisStatus: "analyzed", collectionIds: [collection.id], tags: [{ type: "texture", value: "grain" }] });
    await createReference("Wrong type grain", { analysisStatus: "analyzed", collectionIds: [collection.id] });
    await createReference("Wrong collection grain", { designTypeId: designType.id, analysisStatus: "analyzed" });
    await createReference("Wrong status grain", { designTypeId: designType.id, collectionIds: [collection.id] });
    await createReference("No match", { designTypeId: designType.id, analysisStatus: "analyzed", collectionIds: [collection.id] });
    const query = { q: "grain", designType: designType.slug, collection: collection.slug, status: "analyzed", sort: "title-asc", limit: "1", includeCatalogueIndex: "true" };
    const page1 = await list(query);
    const page2 = await list({ ...query, page: "2" });
    expect(page1).toMatchObject({ total: 2, totalPages: 2, page: 1, limit: 1 });
    expect(page1.items[0]).toMatchObject({ id: first.id, catalogueIndex: 1 });
    expect(page2.items[0]).toMatchObject({ id: second.id, catalogueIndex: 2 });
    expect((await list({ ...query, page: "3" }))).toMatchObject({ items: [], total: 2, totalPages: 2, page: 3 });
    expect((await list({ ...query, collection: "missing" }))).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect((await list({ ...query, designType: "missing" })).total).toBe(0);
  });

  it("keeps catalogue indexes stable across pages and tied sort values", async () => {
    const created = [];
    for (let index = 0; index < 5; index += 1) created.push(await createReference("Same grain"));
    for (const reference of created) {
      await connection.update(references).set({ createdAt: new Date(1_700_000_000_000) }).where(eq(references.id, reference.id));
    }
    const ids = created.map((reference) => reference.id).sort();
    for (const sort of ["newest", "oldest", "title-asc", "title-desc", "relevance"]) {
      const first = await list({ q: "grain", sort, limit: "2", includeCatalogueIndex: "true" });
      const second = await list({ q: "grain", sort, limit: "2", page: "2", includeCatalogueIndex: "true" });
      const last = await list({ q: "grain", sort, limit: "2", page: "3", includeCatalogueIndex: "true" });
      const items = [...first.items, ...second.items, ...last.items];
      expect(items.map((item) => item.id)).toEqual(ids);
      expect(items.map((item) => item.catalogueIndex)).toEqual([1, 2, 3, 4, 5]);
      expect(await list({ q: "grain", sort, limit: "2", page: "2", includeCatalogueIndex: "true" })).toEqual(second);
    }
    expect((await list()).items.every((item) => !Object.hasOwn(item, "catalogueIndex"))).toBe(true);
    expect((await list({ includeCatalogueIndex: "false" })).items.every((item) => !Object.hasOwn(item, "catalogueIndex"))).toBe(true);
  });

  it("sorts titles case-insensitively with UUID as the final tie-breaker", async () => {
    const lower = await createReference("alpha");
    const upper = await createReference("Alpha");
    const beta = await createReference("beta");
    const tied = [lower.id, upper.id].sort();
    expect((await list({ sort: "title-asc" })).items.map((item) => item.id)).toEqual([...tied, beta.id]);
    expect((await list({ sort: "title-desc" })).items.map((item) => item.id)).toEqual([beta.id, ...tied]);
  });

  it("updates the index for edits, shared tag changes, removals and deletion", async () => {
    const first = await createReference("Oldtoken", { tags: [{ type: "texture", value: "woodcut" }] });
    const second = await createReference("Second", { tags: [{ type: "texture", value: "woodcut" }] });
    await updateReference(connection, first.id, { title: "Newtoken" });
    expect((await list({ q: "oldtoken" })).total).toBe(0);
    expect((await list({ q: "newtoken" })).items[0]?.id).toBe(first.id);
    const tagId = first.tags[0]!.id;
    await connection.update(tags).set({ value: "linocut", normalizedValue: "linocut" }).where(eq(tags.id, tagId));
    expect((await list({ q: "woodcut" })).total).toBe(0);
    expect((await list({ q: "linocut" })).total).toBe(2);
    await updateReference(connection, first.id, { tags: [] });
    expect((await list({ q: "linocut" })).items.map((item) => item.id)).toEqual([second.id]);
    await deleteReferenceRecord(connection, second.id);
    expect((await list({ q: "linocut" })).total).toBe(0);
    expect(await queryRows(connection, sql`SELECT count(*)::int AS value FROM reference_search`)).toEqual([{ value: 1 }]);
  });

  it("refreshes both references when a tag association moves and handles tag cascade deletion", async () => {
    const first = await createReference("First", { tags: [{ type: "texture", value: "etching" }] });
    const second = await createReference("Second");
    await connection.update(referenceTags).set({ referenceId: second.id }).where(eq(referenceTags.referenceId, first.id));
    expect((await list({ q: "etching" })).items.map((item) => item.id)).toEqual([second.id]);
    await connection.delete(tags).where(eq(tags.id, first.tags[0]!.id));
    expect((await list({ q: "etching" })).total).toBe(0);
  });

  it("refreshes category names and vocabulary, including reference reassignment", async () => {
    const oldType = await createDesignType(connection, { ...validDesignTypeInput, name: "Ochre", slug: "ochre", vocabulary: ["woodblock"] });
    const newType = await createDesignType(connection, { ...validDesignTypeInput, name: "Linen", slug: "linen", vocabulary: ["letterpress"] });
    const reference = await createReference("Study", { designTypeId: oldType.id });
    expect((await list({ q: "woodblock" })).total).toBe(1);
    await updateDesignType(connection, oldType.id, { name: "Indigo", slug: "indigo", vocabulary: ["cyanotype"] });
    for (const q of ["ochre", "woodblock"]) expect((await list({ q })).total).toBe(0);
    for (const q of ["indigo", "cyanotype"]) expect((await list({ q })).items[0]?.id).toBe(reference.id);
    await updateReference(connection, reference.id, { designTypeId: newType.id });
    expect((await list({ q: "cyanotype" })).total).toBe(0);
    expect((await list({ q: "letterpress" })).total).toBe(1);
    await updateReference(connection, reference.id, { designTypeId: null });
    expect((await list({ q: "letterpress" })).total).toBe(0);
  });

  it("indexes successful analysis imports without leaking protected or rolled-back values", async () => {
    await createDesignType(connection, validDesignTypeInput);
    const reference = await createReference("Handcrafted");
    await updateReference(connection, reference.id, { title: "Protectedword" });
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/analysis/valid.json", import.meta.url)), "utf8")) as Record<string, unknown>;
    const imported = await context.app.inject({ method: "POST", url: "/api/v1/analysis/import", payload: {
      analyses: [{ ...fixture, referenceId: reference.id, title: "Unappliedword" }],
    } });
    expect(imported.json()).toMatchObject({ imported: 1, failed: 0 });
    expect((await list({ q: "protectedword", status: "analyzed" })).total).toBe(1);
    expect((await list({ q: "unappliedword" })).total).toBe(0);
    expect((await list({ q: "fine grain" })).total).toBe(1);
    await expect(connection.transaction(async (transaction) => {
      await updateReference(transaction, reference.id, { title: "Rolledbackword" });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await list({ q: "rolledbackword" })).total).toBe(0);
    expect((await list({ q: "protectedword" })).total).toBe(1);
  });

  it("returns live counts after membership changes, reassignment, collection edits and reference deletion", async () => {
    const firstType = await createDesignType(connection, validDesignTypeInput);
    const secondType = await createDesignType(connection, { ...validDesignTypeInput, name: "Second", slug: "second" });
    const collection = await createCollection(connection, { name: "Keepers", description: "", isPinned: false });
    const first = await createReference("First", { designTypeId: firstType.id, collectionIds: [collection.id] });
    const second = await createReference("Second", { designTypeId: firstType.id, analysisStatus: "analyzed" });
    const counts = async () => {
      const typeResponse = await context.app.inject({ method: "GET", url: "/api/v1/design-types" });
      const collectionResponse = await context.app.inject({ method: "GET", url: "/api/v1/collections" });
      return {
        types: (typeResponse.json() as unknown[]).map((row) => designTypeResponseSchema.parse(row).referenceCount),
        collections: (collectionResponse.json() as unknown[]).map((row) => collectionResponseSchema.parse(row).referenceCount),
      };
    };
    expect(await counts()).toEqual({ types: [2, 0], collections: [1] });
    await addReferenceToCollection(connection, collection.id, second.id);
    await addReferenceToCollection(connection, collection.id, second.id);
    expect((await updateCollection(connection, collection.id, { name: "Selected" })).referenceCount).toBe(2);
    await updateReference(connection, second.id, { designTypeId: secondType.id });
    expect(await counts()).toEqual({ types: [1, 1], collections: [2] });
    await removeReferenceFromCollection(connection, collection.id, first.id);
    await deleteReferenceRecord(connection, second.id);
    expect(await counts()).toEqual({ types: [1, 0], collections: [0] });
  });

  it("handles literal punctuation, blank input and Latin accents without query injection", async () => {
    const target = await createReference("Café grain");
    await createReference("Silk");
    for (const q of ["cafe", "CAFÉ", '"grain"']) expect((await list({ q })).items[0]?.id).toBe(target.id);
    for (const q of ["grain OR silk", "' OR 1=1 --", "title:grain", "\"*%_():-"]) expect((await list({ q })).total).toBe(0);
    expect((await list({ q: "" })).total).toBe(2);
    expect((await list({ q: "   " })).total).toBe(2);
    expect((await list({ q: "palette" })).total).toBe(0);
  });

  it("validates query limits, sort values and the catalogue-index switch", async () => {
    for (const query of [
      { q: "x".repeat(501) }, { page: "1000001" }, { page: "1.5" }, { limit: "101" },
      { sort: "unknown" }, { includeCatalogueIndex: "1" }, { includeCatalogueIndex: "no" },
    ]) {
      const response = await context.app.inject({ method: "GET", url: `/api/v1/references?${new URLSearchParams(query).toString()}` });
      expect(response.statusCode, response.body).toBe(400);
    }
  });

  it("persists searchable UUIDs across an app restart and VACUUM", async () => {
    const deleted = await createReference("Deleted");
    const retained = await createReference("Retainedword");
    await deleteReferenceRecord(connection, deleted.id);
    await connection.execute(sql`VACUUM "references", reference_search`);
    await context.app.close();
    context = await createTestApp("search", { reuse: context });
    expect((await list({ q: "retainedword" })).items[0]?.id).toBe(retained.id);
    await updateReference(connection, retained.id, { title: "Aftervacuum" });
    expect((await list({ q: "retainedword" })).total).toBe(0);
    expect((await list({ q: "aftervacuum" })).total).toBe(1);
    expect(await queryRows(connection, sql`SELECT count(*)::int AS value FROM reference_search`)).toEqual([{ value: 1 }]);
  });

  it("backfills existing references and relations when upgrading from the previous migration", async () => {
    const oldFolder = join(context.directory, "old-migrations");
    mkdirSync(join(oldFolder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    journal.entries = journal.entries.slice(0, 2); // Before 0002_search.
    for (const entry of journal.entries) copyFileSync(join(defaultMigrationsFolder, `${entry.tag}.sql`), join(oldFolder, `${entry.tag}.sql`));
    writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
    const legacyConnection = await openPglite();
    const legacy = legacyConnection.database;
    try {
      await legacyConnection.migrate(oldFolder);
      // Seed the historical schema directly; the services also maintain search tables.
      const designType = { id: randomUUID() };
      await legacy.execute(sql`INSERT INTO design_types (id, slug, name, description, deploy_for, risk, brief_block, sort_order)
        VALUES (${designType.id}, 'editorial-signal', 'Editorial Signal', 'd', 'f', 'r', 'b', 0)`);
      await legacy.execute(sql`INSERT INTO design_type_vocabulary (id, design_type_id, term, sort_order)
        VALUES (${randomUUID()}, ${designType.id}, 'editorial grid', 0)`);
      const id = randomUUID();
      await legacy.insert(references).values({ id, title: "Legacyword", designTypeId: designType.id,
        sourceType: "image", originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`,
        imageWidth: 1, imageHeight: 1, imageFormat: "png", analysisJson: { palette: ["Oldorange"] },
      });
      const tagId = randomUUID();
      await legacy.insert(tags).values({ id: tagId, type: "texture", value: "Oldgrain", normalizedValue: "oldgrain" });
      await legacy.insert(referenceTags).values({ referenceId: id, tagId, sortOrder: 0 });
      await legacyConnection.migrate();
      await legacyConnection.migrate();
      for (const q of ["legacyword", "oldgrain", "oldorange", "editorial grid"]) {
        expect((await listReferences(legacy, referenceListQuerySchema.parse({ q }))).items[0]?.id).toBe(id);
      }
      expect(await queryRows(legacy, sql`SELECT count(*)::int AS value FROM reference_search`)).toEqual([{ value: 1 }]);
    } finally {
      await legacyConnection.close();
    }
  });
});
