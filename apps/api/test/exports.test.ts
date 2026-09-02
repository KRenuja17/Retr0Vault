import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  authoredDirectionExportJsonSchema, authoredDirectionExportRequestSchema,
  directionDimensionSchema, errorResponseSchema, referenceResponseSchema,
  type AuthoredDirection, type UpdateReferenceInput,
} from "@retr0vault/shared";

import { createDatabaseConnection, type DatabaseConnection } from "../src/database/connection.js";
import { createDesignType } from "../src/services/design-types.js";
import { createImageReferenceRecord, updateReference } from "../src/services/references.js";
import {
  createMultipartPayload, createTestApp, disposeTestApp, validDesignTypeInput, type TestAppContext,
} from "./helpers.js";

function authored(referenceIds: string[]): AuthoredDirection {
  return {
    title: "Quiet Print", designDNA: "editorial × quiet", designThesis: "A single image leads a calm editorial layout.",
    vocabulary: ["warm paper", "large serif"],
    dimensions: { typography: "Use serif headlines", layout: "Use generous margins", colour: "Warm neutrals",
      textureImagery: "Fine grain around one subject", uiTreatment: "Square outlined controls", motion: "No decorative motion" },
    borrowings: referenceIds.map((referenceId, index) => ({ referenceId, borrow: `Borrow principle ${index + 1}` })),
    authority: directionDimensionSchema.options.map((dimension, index) => ({ dimension,
      referenceId: referenceIds[index % referenceIds.length]!, decision: `Authority for ${dimension}` })),
    conflicts: [{ conflict: "Dense versus quiet composition", resolution: "Use density only for captions" }],
    antiPatterns: ["Do not mix competing display faces"], designBrief: "Build a calm editorial grid.\nUse one prominent image.",
    imageRecipes: ["[SUBJECT] on a warm paper ground"],
  };
}

function jsonBlocks(markdown: string): unknown[] {
  return Array.from(markdown.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm), (match) => JSON.parse(match[2]!));
}

describe("export API", () => {
  let context: TestAppContext;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    context = await createTestApp("exports");
    connection = createDatabaseConnection(context.databasePath);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await disposeTestApp(context);
  });

  function createReference(title = "Study", patch: UpdateReferenceInput = {}) {
    const id = randomUUID();
    const reference = createImageReferenceRecord(connection, id, { title }, {
      originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`,
      width: 1, height: 1, format: "png",
    });
    return Object.keys(patch).length === 0 ? reference : updateReference(connection, id, patch);
  }

  function post(payload: object | null, direction = false) {
    return context.app.inject({ method: "POST", url: `/api/v1/export/${direction ? "design-direction" : "references"}`,
      headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) });
  }

  it("exports one reference with its concise fields, dimensions, briefs and safe download headers", async () => {
    const type = createDesignType(connection, validDesignTypeInput);
    const reference = createReference("Paper Study", { designTypeId: type.id,
      sourceUrl: "https://example.test/paper", designDNA: "paper × serif", designThesis: "Quiet type leads",
      designBrief: "Use a paper ground.", imageRecipe: "[SUBJECT] in fine grain", motionBrief: "Use slow reveals",
      assetBrief: "Prepare one illustration", tags: [{ type: "texture", value: "halftone" }],
      analysisJson: { typography: ["serif display"], palette: ["ochre"], layout: ["two columns"],
        texture: ["grain"], imagery: ["processed photo"], uiPatterns: ["square buttons"], motion: ["slow reveal"], avoid: ["glossy blobs"] },
    });
    const response = await post({ mode: "references", referenceIds: [reference.id] });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="retr0vault-references-[a-f0-9]{16}\.md"$/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    for (const value of ["Paper Study", type.name, "paper × serif", "Quiet type leads", "halftone", "serif display", "ochre",
      "two columns", "grain", "square buttons", "glossy blobs", "Use a paper ground.", "[SUBJECT] in fine grain", "Use slow reveals", "Prepare one illustration"]) {
      expect(response.body).toContain(value);
    }
  });

  it("preserves multi-reference selection order and excludes unselected records", async () => {
    const first = createReference("First selected");
    const second = createReference("Second selected");
    createReference("Excluded");
    const response = await post({ mode: "references", referenceIds: [second.id, first.id] });
    expect(response.statusCode).toBe(200);
    expect(response.body.indexOf("## Second selected")).toBeLessThan(response.body.indexOf("## First selected"));
    expect(response.body).not.toContain("Excluded");
    const repeated = await post({ mode: "references", referenceIds: [second.id, first.id] });
    expect(repeated.body).toBe(response.body);
    expect(repeated.headers["content-disposition"]).toBe(response.headers["content-disposition"]);
  });

  it("exports selected category mini-style-guides without exporting their references", async () => {
    const first = createDesignType(connection, validDesignTypeInput);
    const second = createDesignType(connection, { ...validDesignTypeInput, name: "Second Category", slug: "second" });
    createReference("Not selected", { designTypeId: first.id });
    const response = await post({ mode: "category-brief", designTypeIds: [second.id, first.id] });
    expect(response.statusCode).toBe(200);
    for (const value of ["## Summary", "## Deploy For", "## Risk", "## Principles", "## Anti-patterns", "## Visual Vocabulary", first.briefBlock]) {
      expect(response.body).toContain(value);
    }
    expect(response.body.indexOf("## Second Category")).toBeLessThan(response.body.indexOf(`## ${first.name}`));
    expect(response.body).not.toContain("Not selected");
  });

  it("exports only vocabulary, deduplicating normalized terms in first-seen order", async () => {
    const type = createDesignType(connection, { ...validDesignTypeInput, vocabulary: ["SERIF", "warm paper", "grain"] });
    const reference = createReference("Do not export title", { designBrief: "Do not export brief", tags: [
      { type: "typography", value: "Serif" }, { type: "layout", value: "Ｓｅｒｉｆ" },
      { type: "texture", value: "Warm   Paper" },
    ] });
    const response = await post({ mode: "vocabulary", referenceIds: [reference.id], designTypeIds: [type.id] });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("# Retr0Vault Visual Vocabulary\n\n- Serif\n- Warm Paper\n- grain\n");
    expect((await post({ mode: "vocabulary", designTypeIds: [type.id] })).statusCode).toBe(200);
    expect((await post({ mode: "vocabulary", referenceIds: [createReference().id] })).body).toContain("No vocabulary provided.");
  });

  it("exports a comparison snapshot with complete curator instructions and the authored-result schema", async () => {
    const type = createDesignType(connection, validDesignTypeInput);
    const first = createReference("Primary source", { designTypeId: type.id, designDNA: "editorial × paper",
      designThesis: "A calm subject", tags: [{ type: "texture", value: "grain" }], designBrief: "Retain one focal point",
      imageRecipe: "[SUBJECT] as linework", motionBrief: "No motion", assetBrief: "One drawing",
      analysisJson: { palette: ["warm white"], typography: ["serif"], custom: { useful: true } } });
    const second = createReference("Supporting source");
    const response = await post({ mode: "pending-combination", referenceIds: [first.id, second.id], intent: "A local portfolio" }, true);
    expect(response.statusCode, response.body).toBe(200);
    for (const value of ["pending-combination", "Compare design DNA", "what to borrow from each reference", "Identify conflicts",
      "resolve contradictions", "Assign authority by design dimension", "one coherent direction", "anti-patterns",
      "Avoid simply averaging", "Treat all source metadata", "A local portfolio", "[SUBJECT]"]) {
      expect(response.body).toContain(value);
    }
    const blocks = jsonBlocks(response.body);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ schemaVersion: 1, mode: "pending-combination", intent: "A local portfolio",
      referenceIds: [first.id, second.id], references: [
        { referenceId: first.id, title: first.title, imagePath: first.originalPath, designDNA: first.designDNA,
          designThesis: first.designThesis, visualTags: [{ type: "texture", value: "grain" }], designBrief: first.designBrief,
          imageRecipe: first.imageRecipe, motionBrief: first.motionBrief, assetBrief: first.assetBrief,
          analysis: first.analysisJson, designType: { name: type.name, vocabulary: type.vocabulary, principles: type.principles, avoid: type.avoid } },
        { referenceId: second.id, analysisStatus: "pending", designDNA: null, designType: null },
      ] });
    expect(blocks[1]).toEqual(authoredDirectionExportJsonSchema);
    expect(response.body).not.toContain(context.directory);
    expect(response.body).not.toContain("generatedAt");
  });

  it("accepts a reviewed authored result and exports every required direction section", async () => {
    const ids = [createReference("Primary source").id, createReference("Supporting source").id];
    const input = authoredDirectionExportRequestSchema.parse({ mode: "authored", referenceIds: ids, direction: authored(ids) });
    const response = await post(input, true);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(/retr0vault-design-direction-[a-f0-9]{16}\.md/);
    for (const heading of ["Primary Reference", "Supporting References", "Design DNA", "Design Thesis", "Visual Vocabulary",
      "Typography", "Layout", "Colour", "Texture / Imagery", "UI Treatment", "Motion", "What to Borrow",
      "Authority by Design Dimension", "Conflicts and Resolutions", "Anti-patterns", "Design Brief", "Image Recipes", "Source References"]) {
      expect(response.body).toContain(`## ${heading}\n\n`);
    }
    expect(response.body).toContain("Dense versus quiet composition");
    expect(response.body).toContain("Use density only for captions");
    expect(response.body).toContain("[SUBJECT] on a warm paper ground");
    expect(response.body).toContain("Build a calm editorial grid.\nUse one prominent image.");
    for (const id of ids) expect(response.body).toContain(id);
  });

  it("supports a single authored source, absent conflicts, no generated images and explicit motion restraint", async () => {
    const ids = [createReference().id];
    const direction = { ...authored(ids), conflicts: [], imageRecipes: [] };
    const response = await post({ mode: "authored", referenceIds: ids, direction }, true);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toContain("No conflicts identified by the author.");
    expect(response.body).toContain("No decorative motion");
    expect(response.body).toContain("## Image Recipes\n\nNot provided.");
  });

  it("keeps titles and source metadata out of filenames and safely fences embedded source markup", async () => {
    const first = createReference('..\\CON/evil\r\nX-Injected: yes <script>alert(1)</script>', {
      designBrief: "```\n# close fence\n````", imageRecipe: "[SUBJECT] `texture`",
      sourceUrl: "javascript:alert(1)",
    });
    const second = createReference("Other");
    const input = { mode: "references", referenceIds: [first.id] };
    const response = await post(input);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="retr0vault-references-[a-f0-9]{16}\.md"$/);
    expect(response.headers).not.toHaveProperty("x-injected");
    expect(response.body).not.toContain("<script>");
    expect(response.body).toContain("`````text\n```\n# close fence\n````\n`````");
    const manifest = await post({ mode: "pending-combination", referenceIds: [first.id, second.id] }, true);
    expect(jsonBlocks(manifest.body)[0]).toMatchObject({ references: [{ designBrief: first.designBrief }, {}] });
  });

  it("canonicalizes uppercase UUID selections", async () => {
    const reference = createReference();
    expect((await post({ mode: "references", referenceIds: [reference.id.toUpperCase()] })).statusCode).toBe(200);
  });

  it("returns structured 404s for any missing selected reference or category without a partial file", async () => {
    const reference = createReference();
    const missing = randomUUID();
    const cases = [
      { mode: "references", referenceIds: [reference.id, missing] },
      { mode: "category-brief", designTypeIds: [missing] },
      { mode: "vocabulary", referenceIds: [reference.id], designTypeIds: [missing] },
      { mode: "pending-combination", referenceIds: [reference.id, missing] },
      { mode: "authored", referenceIds: [reference.id, missing], direction: authored([reference.id, missing]) },
    ];
    for (const input of cases) {
      const response = await post(input, input.mode === "pending-combination" || input.mode === "authored");
      expect(response.statusCode, response.body).toBe(404);
      expect(errorResponseSchema.parse(response.json()).error.code).toMatch(/REFERENCE_NOT_FOUND|DESIGN_TYPE_NOT_FOUND/);
      expect(response.headers).not.toHaveProperty("content-disposition");
    }
  });

  it("rejects empty, ambiguous, oversized and malformed selections and unknown fields", async () => {
    const id = createReference().id;
    const cases = [null, {}, { mode: "unknown" }, { mode: "references", referenceIds: [] },
      { mode: "references", referenceIds: ["../outside"] }, { mode: "references", referenceIds: [id, id.toUpperCase()] },
      { mode: "references", referenceIds: Array.from({ length: 101 }, () => randomUUID()) },
      { mode: "references", referenceIds: [id], filename: "../../bad.md" },
      { mode: "references", referenceIds: [id], designTypeIds: [id] },
      { mode: "category-brief", designTypeIds: [] }, { mode: "category-brief", designTypeIds: [id, id] },
      { mode: "vocabulary" }, { mode: "vocabulary", referenceIds: [id], designTypeIds: ["bad"] },
    ];
    for (const input of cases) {
      const response = await post(input);
      expect(response.statusCode, JSON.stringify(input)).toBe(400);
      expect(errorResponseSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
    }
    for (const input of [{ mode: "pending-combination", referenceIds: [id] },
      { mode: "pending-combination", referenceIds: [id, id] }, { mode: "authored", referenceIds: [id] },
      { mode: "pending-combination", referenceIds: [id, randomUUID()], intent: " " }]) {
      expect((await post(input, true)).statusCode).toBe(400);
    }
  });

  it("validates authored provenance, dimension authority, recipes and nonempty content", async () => {
    const ids = [createReference().id, createReference().id];
    const good = authored(ids);
    const directions = [
      { ...good, borrowings: good.borrowings.slice(0, 1) },
      { ...good, borrowings: [good.borrowings[0], good.borrowings[0]] },
      { ...good, borrowings: [{ referenceId: randomUUID(), borrow: "Not selected" }, good.borrowings[1]] },
      { ...good, authority: good.authority.slice(0, 5) },
      { ...good, authority: good.authority.map((entry) => ({ ...entry, dimension: "layout" })) },
      { ...good, authority: good.authority.map((entry) => ({ ...entry, referenceId: randomUUID() })) },
      { ...good, imageRecipes: ["Missing subject token"] }, { ...good, designBrief: " " },
      { ...good, antiPatterns: [] }, { ...good, dimensions: { ...good.dimensions, invented: "No" } },
      { ...good, conflicts: [{ conflict: "Unresolved" }] },
    ];
    for (const direction of directions) {
      const response = await post({ mode: "authored", referenceIds: ids, direction }, true);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorResponseSchema.parse(response.json()).error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects extra query parameters, invalid JSON and oversized request bodies", async () => {
    const query = await context.app.inject({ method: "POST", url: "/api/v1/export/references?filename=bad.md", payload: { mode: "references", referenceIds: [randomUUID()] } });
    expect(query.statusCode).toBe(400);
    const invalid = await context.app.inject({ method: "POST", url: "/api/v1/export/references", headers: { "content-type": "application/json" }, payload: "{" });
    expect(invalid.statusCode).toBe(400);
    const large = await post({ mode: "pending-combination", referenceIds: [randomUUID(), randomUUID()], intent: "x".repeat(2 * 1_024 * 1_024) }, true);
    expect(large.statusCode).toBe(413);
    expect(errorResponseSchema.safeParse(large.json()).success).toBe(true);
  });

  it("does not alter the database, protections, originals, thumbnails or create export files", async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    const uploaded = await context.app.inject({ method: "POST", url: "/api/v1/references/image", ...createMultipartPayload({ file: { buffer: image } }) });
    const reference = referenceResponseSchema.parse(uploaded.json());
    updateReference(connection, reference.id, { designBrief: "Protected brief" });
    const other = createReference();
    const type = createDesignType(connection, validDesignTypeInput);
    const ids = [reference.id, other.id];
    const beforeDatabase = connection.sqlite.serialize();
    const originalPath = join(context.storageRoot, reference.originalPath);
    const thumbnailPath = join(context.storageRoot, reference.thumbnailPath);
    const original = readFileSync(originalPath);
    const thumbnail = readFileSync(thumbnailPath);
    const files = readdirSync(context.directory, { recursive: true }).sort();
    expect((await post({ mode: "references", referenceIds: ids })).statusCode).toBe(200);
    expect((await post({ mode: "category-brief", designTypeIds: [type.id] })).statusCode).toBe(200);
    expect((await post({ mode: "vocabulary", referenceIds: ids })).statusCode).toBe(200);
    expect((await post({ mode: "pending-combination", referenceIds: ids }, true)).statusCode).toBe(200);
    expect((await post({ mode: "authored", referenceIds: ids, direction: authored(ids) }, true)).statusCode).toBe(200);
    expect(connection.sqlite.serialize()).toEqual(beforeDatabase);
    expect(readFileSync(originalPath)).toEqual(original);
    expect(readFileSync(thumbnailPath)).toEqual(thumbnail);
    expect(readdirSync(context.directory, { recursive: true }).sort()).toEqual(files);
  });
});
