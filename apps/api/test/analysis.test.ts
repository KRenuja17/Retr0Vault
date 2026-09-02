import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  analysisImportReportSchema, pendingAnalysisManifestSchema,
  protectedFieldSchema, referenceAnalysisJsonSchema, referenceAnalysisSchema,
  referenceResponseSchema,
} from "@retr0vault/shared";

import { exportPendingAnalysis, importAnalysisFiles, maximumAnalysisFileBytes } from "../src/analysis/files.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseConnection, type DatabaseConnection } from "../src/database/connection.js";
import { applyMigrations, defaultMigrationsFolder } from "../src/database/migrate.js";
import { references } from "../src/database/schema.js";
import { createDesignType } from "../src/services/design-types.js";
import { createImageReferenceRecord, getReference } from "../src/services/references.js";
import { ReferenceStorage } from "../src/storage/reference-storage.js";
import { createTestApp, disposeTestApp, validDesignTypeInput, type TestAppContext } from "./helpers.js";

const fixtureDirectory = fileURLToPath(new URL("./fixtures/analysis/", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = referenceAnalysisSchema.parse(JSON.parse(readFileSync(join(fixtureDirectory, "valid.json"), "utf8")));
const analysisFor = (referenceId: string) => referenceAnalysisSchema.parse({ ...fixture, referenceId });

describe("external-curator analysis", () => {
  let context: TestAppContext;
  let connection: DatabaseConnection;
  let storage: ReferenceStorage;
  let image: Buffer;

  beforeEach(async () => {
    context = await createTestApp("analysis");
    connection = createDatabaseConnection(context.databasePath);
    storage = new ReferenceStorage(context.storageRoot);
    createDesignType(connection, validDesignTypeInput);
    image = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#eeeecc" } }).png().toBuffer();
  });

  afterEach(async () => {
    connection.sqlite.close();
    await disposeTestApp(context);
  });

  async function createReference(title = "Uncurated") {
    const id = randomUUID();
    const stored = await storage.storeImage(id, image, await storage.inspectImage(image));
    return createImageReferenceRecord(connection, id, { title }, stored);
  }

  async function importViaApi(analyses: unknown[], overwriteProtected = false) {
    const response = await context.app.inject({
      method: "POST", url: "/api/v1/analysis/import", payload: { analyses, overwriteProtected },
    });
    expect(response.statusCode, response.body).toBe(200);
    return analysisImportReportSchema.parse(response.json());
  }

  it("shares a strict Zod contract and matching JSON Schema with fixtures", () => {
    expect(referenceAnalysisSchema.safeParse(fixture).success).toBe(true);
    expect(referenceAnalysisSchema.safeParse(JSON.parse(readFileSync(join(fixtureDirectory, "invalid.json"), "utf8"))).success).toBe(false);
    expect(referenceAnalysisSchema.safeParse({ ...fixture, imageRecipe: "No subject token" }).success).toBe(false);
    expect(referenceAnalysisSchema.safeParse({ ...fixture, title: " " }).success).toBe(false);
    expect(referenceAnalysisSchema.safeParse({ ...fixture, analysisStatus: "analyzed" }).success).toBe(false);
    expect(referenceAnalysisSchema.safeParse({ ...fixture, analysis: { palette: [] } }).success).toBe(false);
    expect(referenceAnalysisJsonSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false,
      properties: { referenceId: { format: "uuid" }, imageRecipe: { pattern: "\\[SUBJECT\\]" } },
    });
    expect(referenceAnalysisJsonSchema.required).toContain("analysis");
    expect(referenceAnalysisJsonSchema.required).not.toContain("motionBrief");
  });

  it("imports and reimports metadata and normalized tags without touching image/source/membership", async () => {
    const reference = await createReference();
    const analysis = analysisFor(reference.id);
    const first = await importViaApi([analysis]);
    expect(first).toMatchObject({ imported: 1, failed: 0 });
    const updated = getReference(connection, reference.id);
    expect(updated).toMatchObject({
      title: analysis.title, designDNA: analysis.designDNA, designThesis: analysis.designThesis,
      designBrief: analysis.designBrief, imageRecipe: analysis.imageRecipe,
      motionBrief: null, assetBrief: analysis.assetBrief, analysisJson: analysis.analysis,
      analysisStatus: "analyzed", protectedFields: [], originalPath: reference.originalPath,
      sourceUrl: reference.sourceUrl, collectionIds: reference.collectionIds,
    });
    expect(updated.tags.map((tag) => [tag.type, tag.normalizedValue, tag.sortOrder])).toEqual([
      ["texture", "fine grain", 0], ["typography", "monumental serif", 1],
    ]);
    const second = await importViaApi([analysis]);
    expect(second.imported).toBe(1);
    expect(getReference(connection, reference.id).tags).toEqual(updated.tags);
    expect(readFileSync(join(context.storageRoot, reference.originalPath))).toEqual(image);
  });

  it("isolates invalid records, unknown IDs/types, and duplicate IDs in a mixed batch", async () => {
    const good = await createReference("Good");
    const bad = await createReference("Do not change");
    const unknownType = await createReference("Unknown type");
    const report = await importViaApi([
      analysisFor(good.id),
      { ...analysisFor(bad.id), originalPath: "../../escape.png" },
      analysisFor(randomUUID()),
      { ...analysisFor(unknownType.id), designType: "Invented Type" },
      { ...analysisFor(good.id), title: "Duplicate must not win" },
    ]);
    expect(report).toMatchObject({ imported: 1, failed: 4 });
    expect(report.results.map((result) => result.error?.code)).toEqual([
      undefined, "INVALID_ANALYSIS", "REFERENCE_NOT_FOUND", "INVALID_DESIGN_TYPE", "DUPLICATE_REFERENCE",
    ]);
    expect(getReference(connection, good.id).title).toBe("Paper Signals");
    expect(getReference(connection, bad.id)).toEqual(bad);
    expect(getReference(connection, unknownType.id)).toEqual(unknownType);
  });

  it("rolls back metadata, status and tags together after a database failure", async () => {
    const blocked = await createReference("Protected by DB");
    const allowed = await createReference("Allowed");
    connection.sqlite.exec(`CREATE TRIGGER reject_test_tags BEFORE INSERT ON reference_tags
      WHEN new.reference_id = '${blocked.id}' BEGIN SELECT RAISE(ABORT, 'test constraint'); END`);
    const report = await importViaApi([analysisFor(blocked.id), analysisFor(allowed.id)]);
    expect(report).toMatchObject({ imported: 1, failed: 1 });
    expect(getReference(connection, blocked.id)).toEqual(blocked);
    expect(getReference(connection, allowed.id).analysisStatus).toBe("analyzed");
  });

  it("rejects duplicate normalized tags without mutating the reference", async () => {
    const reference = await createReference();
    const report = await importViaApi([{ ...analysisFor(reference.id), visualTags: [
      { type: "texture", value: "Fine Grain" }, { type: "TEXTURE", value: "fine   grain" },
    ] }]);
    expect(report.failed).toBe(1);
    expect(getReference(connection, reference.id)).toEqual(reference);
  });

  it("preserves manually edited fields and tags unless explicitly overridden", async () => {
    const reference = await createReference();
    const patch = await context.app.inject({
      method: "PATCH", url: `/api/v1/references/${reference.id}`,
      payload: { title: "My title", designDNA: "My DNA", tags: [{ type: "texture", value: "My texture" }] },
    });
    expect(patch.statusCode).toBe(200);
    expect(referenceResponseSchema.parse(patch.json()).protectedFields).toEqual(["title", "designDNA", "tags"]);
    const report = await importViaApi([analysisFor(reference.id)]);
    expect(report.results[0]?.preservedFields).toEqual(["title", "designDNA", "tags"]);
    expect(getReference(connection, reference.id)).toMatchObject({
      title: "My title", designDNA: "My DNA", analysisStatus: "analyzed",
      tags: [{ value: "My texture" }], designBrief: fixture.designBrief,
    });
    const override = await importViaApi([analysisFor(reference.id)], true);
    expect(override.results[0]?.preservedFields).toEqual([]);
    expect(getReference(connection, reference.id)).toMatchObject({
      title: "Paper Signals", protectedFields: ["title", "designDNA", "tags"],
    });
    await importViaApi([{ ...analysisFor(reference.id), title: "Must remain locked" }]);
    expect(getReference(connection, reference.id).title).toBe("Paper Signals");
  });

  it("keeps manual protections through reset and supports deliberate unlocking", async () => {
    const reference = await createReference();
    const manual = await context.app.inject({
      method: "PATCH", url: `/api/v1/references/${reference.id}`,
      payload: { analysisStatus: "manual", designBrief: "Hand authored" },
    });
    const before = referenceResponseSchema.parse(manual.json());
    expect(new Set(before.protectedFields)).toEqual(new Set(protectedFieldSchema.options));
    const reset = await context.app.inject({ method: "POST", url: `/api/v1/analysis/${reference.id}/reset` });
    const after = referenceResponseSchema.parse(reset.json());
    expect({ ...after, updatedAt: before.updatedAt, analysisStatus: before.analysisStatus }).toEqual(before);
    expect(after.analysisStatus).toBe("pending");
    await importViaApi([analysisFor(reference.id)]);
    expect(getReference(connection, reference.id).designBrief).toBe("Hand authored");
    const unlock = await context.app.inject({
      method: "PATCH", url: `/api/v1/references/${reference.id}`, payload: { protectedFields: [] },
    });
    expect(unlock.statusCode).toBe(200);
    await importViaApi([analysisFor(reference.id)]);
    expect(getReference(connection, reference.id).designBrief).toBe(fixture.designBrief);
    expect(readFileSync(join(context.storageRoot, reference.originalPath))).toEqual(image);
  });

  it("preserves omitted optional briefs but clears explicit nulls", async () => {
    const reference = await createReference();
    await importViaApi([analysisFor(reference.id)]);
    const { assetBrief: _assetBrief, motionBrief: _motionBrief, ...withoutOptional } = analysisFor(reference.id);
    await importViaApi([withoutOptional]);
    expect(getReference(connection, reference.id).assetBrief).toBe(fixture.assetBrief);
    await importViaApi([{ ...withoutOptional, assetBrief: null }]);
    expect(getReference(connection, reference.id).assetBrief).toBeNull();
  });

  it("returns only pending references with schema and safe absolute image paths without writing files", async () => {
    const pending = await createReference("Pending");
    const analyzed = await createReference("Analyzed");
    await importViaApi([analysisFor(analyzed.id)]);
    const response = await context.app.inject({ method: "GET", url: "/api/v1/analysis/pending" });
    expect(response.statusCode).toBe(200);
    const manifest = pendingAnalysisManifestSchema.parse(response.json());
    expect(manifest.references.map((item) => item.referenceId)).toEqual([pending.id]);
    expect(manifest.references[0]?.imagePath).toBe(resolve(context.storageRoot, pending.originalPath));
    expect(manifest.analysisSchema).toEqual(referenceAnalysisJsonSchema);
    expect(manifest.designTypes[0]).toMatchObject({ name: "Editorial Signal", slug: "editorial-signal" });
    expect(manifest.resultsDirectory).toBe(join(context.directory, "data", "analysis-results"));
    expect(existsSync(join(context.directory, "data"))).toBe(false);
  });

  it("exports manifests and instructions without duplicating images, and reports unsafe or missing originals", async () => {
    const good = await createReference();
    const unsafe = await createReference();
    const missing = await createReference();
    connection.database.update(references).set({ originalPath: "../../private.png" }).where(eq(references.id, unsafe.id)).run();
    connection.database.update(references).set({ originalPath: `originals/${missing.id}.jpg` }).where(eq(references.id, missing.id)).run();
    const dataDirectory = join(context.directory, "data");
    const result = await exportPendingAnalysis(connection, storage, dataDirectory);
    expect(result.exported).toBe(1);
    expect(result.unavailable).toHaveLength(2);
    const manifest = pendingAnalysisManifestSchema.parse(JSON.parse(readFileSync(result.manifestPath, "utf8")));
    expect(manifest.references[0]?.referenceId).toBe(good.id);
    expect(readFileSync(result.manifestPath, "utf8")).not.toContain("private.png");
    expect(readFileSync(join(dataDirectory, "analysis-inbox", "instructions.md"), "utf8")).toContain("[SUBJECT]");
    await exportPendingAnalysis(connection, storage, dataDirectory);
    expect(readdirSync(join(dataDirectory, "analysis-inbox")).sort()).toEqual(["instructions.md", "manifest.json"]);
    expect(readFileSync(join(context.storageRoot, good.originalPath))).toEqual(image);
    expect(getReference(connection, missing.id).analysisStatus).toBe("pending");
  });

  it("does not expose an image through an out-of-root directory junction", async () => {
    const root = join(context.directory, "linked-storage");
    const outside = join(context.directory, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    const id = randomUUID();
    writeFileSync(join(outside, `${id}.png`), image);
    symlinkSync(outside, join(root, "originals"), "junction");
    await expect(new ReferenceStorage(root).getOriginalImagePath(id, `originals/${id}.png`)).rejects.toThrow(/inside the storage root/);
    expect(readFileSync(join(outside, `${id}.png`))).toEqual(image);
  });

  it("imports local files independently with size limits, BOM support, and no deletion", async () => {
    const reference = await createReference();
    const results = join(context.directory, "analysis-results");
    mkdirSync(results);
    const goodFile = join(results, "01-good.json");
    const goodContents = `\uFEFF${JSON.stringify(analysisFor(reference.id))}`;
    writeFileSync(goodFile, goodContents);
    writeFileSync(join(results, "02-invalid.json"), "{not json");
    copyFileSync(join(fixtureDirectory, "invalid.json"), join(results, "03-schema.json"));
    writeFileSync(join(results, "04-large.json"), Buffer.alloc(maximumAnalysisFileBytes + 1, 32));
    writeFileSync(join(results, "05-duplicate.JSON"), JSON.stringify(analysisFor(reference.id)));
    writeFileSync(join(results, "ignore.txt"), "unchanged");
    const report = await importAnalysisFiles(connection, results);
    expect(report).toMatchObject({ imported: 1, failed: 4 });
    expect(report.results.map((result) => result.error?.code)).toEqual([
      undefined, "INVALID_RESULT_FILE", "INVALID_ANALYSIS", "INVALID_RESULT_FILE", "DUPLICATE_REFERENCE",
    ]);
    expect(readFileSync(goodFile, "utf8")).toBe(goodContents);
    expect(readdirSync(results)).toHaveLength(6);
    expect(getReference(connection, reference.id).analysisStatus).toBe("analyzed");
    expect(await importAnalysisFiles(connection, join(context.directory, "missing-results"))).toEqual({ imported: 0, failed: 0, results: [] });
  });

  it("runs the CLI export/import and explicit override against isolated runtime directories", async () => {
    const reference = await createReference();
    const dataDirectory = join(context.directory, "cli-data");
    const run = (...args: string[]) => spawnSync(process.execPath, [
      join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      "--tsconfig", join(repositoryRoot, "tsconfig.typecheck.json"),
      join(repositoryRoot, "apps", "api", "src", "analysis", "cli.ts"), ...args,
    ], { cwd: repositoryRoot, encoding: "utf8", timeout: 15_000, env: {
      ...process.env, DATABASE_PATH: context.databasePath, STORAGE_ROOT: context.storageRoot,
      ANALYSIS_DATA_DIR: dataDirectory,
    } });
    const exported = run("export");
    expect(exported.status, exported.stderr).toBe(0);
    expect(JSON.parse(exported.stdout).exported).toBe(1);
    const results = join(dataDirectory, "analysis-results");
    mkdirSync(results);
    writeFileSync(join(results, "valid.json"), JSON.stringify(analysisFor(reference.id)));
    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${reference.id}`, payload: { title: "Manual" } });
    const imported = run("import");
    expect(imported.status, imported.stderr).toBe(0);
    expect(JSON.parse(imported.stdout).imported).toBe(1);
    expect(getReference(connection, reference.id).title).toBe("Manual");
    const forced = run("import", "--overwrite-protected");
    expect(forced.status, forced.stderr).toBe(0);
    expect(getReference(connection, reference.id).title).toBe("Paper Signals");
    writeFileSync(join(results, "bad.json"), "{}");
    const partial = run("import");
    expect(partial.status).toBe(1);
    expect(JSON.parse(partial.stdout)).toMatchObject({ imported: 1, failed: 1 });
    const invalidArgs = run("import", "--unexpected");
    expect(invalidArgs.status).toBe(1);
    expect(invalidArgs.stderr).toContain("Invalid analysis command");
  }, 30_000);

  it("validates import envelopes, protection names, reset bodies and missing references", async () => {
    for (const payload of [{ analyses: [] }, { analyses: [fixture], overwriteProtected: "true" }, { analyses: [fixture], dangerous: true }]) {
      expect((await context.app.inject({ method: "POST", url: "/api/v1/analysis/import", payload })).statusCode).toBe(400);
    }
    const reference = await createReference();
    expect((await context.app.inject({ method: "PATCH", url: `/api/v1/references/${reference.id}`, payload: { protectedFields: ["originalPath"] } })).statusCode).toBe(400);
    expect((await context.app.inject({ method: "POST", url: `/api/v1/analysis/${reference.id}/reset`, payload: { clearFiles: true } })).statusCode).toBe(400);
    expect((await context.app.inject({ method: "POST", url: `/api/v1/analysis/${randomUUID()}/reset` })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "POST", url: "/api/v1/analysis/not-a-uuid/reset" })).statusCode).toBe(400);
  });

  it("upgrades existing manual references with protections without changing their metadata", () => {
    const oldFolder = join(context.directory, "old-migrations");
    mkdirSync(join(oldFolder, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    journal.entries = journal.entries.slice(0, 3);
    for (const entry of journal.entries) copyFileSync(join(defaultMigrationsFolder, `${entry.tag}.sql`), join(oldFolder, `${entry.tag}.sql`));
    writeFileSync(join(oldFolder, "meta", "_journal.json"), JSON.stringify(journal));
    const legacy = createDatabaseConnection(join(context.directory, "legacy.db"));
    try {
      applyMigrations(legacy, oldFolder);
      const manualId = randomUUID();
      const pendingId = randomUUID();
      for (const [id, status] of [[manualId, "manual"], [pendingId, "pending"]]) {
        legacy.sqlite.prepare(`INSERT INTO "references"
          (id, title, source_type, original_path, thumbnail_path, image_width, image_height, image_format, analysis_status, design_brief)
          VALUES (?, 'Legacy title', 'image', 'original.png', 'thumb.webp', 1, 1, 'png', ?, 'Legacy brief')`).run(id, status);
      }
      applyMigrations(legacy);
      applyMigrations(legacy);
      expect(getReference(legacy, manualId)).toMatchObject({ title: "Legacy title", designBrief: "Legacy brief", analysisStatus: "manual" });
      expect(getReference(legacy, manualId).protectedFields).toEqual(protectedFieldSchema.options);
      expect(getReference(legacy, pendingId).protectedFields).toEqual([]);
    } finally {
      legacy.sqlite.close();
    }
  });
});
