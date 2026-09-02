import { z } from "zod";

import { protectedFieldsSchema, referenceTagInputSchema } from "./references.js";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const observations = z.array(text(2_000)).max(100);

export const detailedAnalysisSchema = z.object({
  palette: observations,
  typography: observations,
  layout: observations,
  texture: observations,
  imagery: observations,
  uiPatterns: observations,
  motion: observations,
  avoid: observations,
}).strict();

export const referenceAnalysisSchema = z.object({
  referenceId: z.uuid(),
  title: text(300),
  designType: text(100).describe("An existing design-type name or slug from the manifest"),
  designDNA: text(1_000),
  designThesis: text(5_000),
  visualTags: z.array(referenceTagInputSchema).max(200),
  designBrief: text(20_000),
  imageRecipe: text(20_000).regex(/\[SUBJECT\]/u, "Image recipe must include [SUBJECT]"),
  motionBrief: text(20_000).nullable().optional(),
  assetBrief: text(20_000).nullable().optional(),
  analysis: detailedAnalysisSchema,
}).strict();

export type ReferenceAnalysis = z.infer<typeof referenceAnalysisSchema>;

export const referenceAnalysisJsonSchema = z.toJSONSchema(referenceAnalysisSchema, {
  target: "draft-2020-12",
  io: "input",
});

// Validate each record separately so a bad result never aborts valid siblings.
export const analysisImportRequestSchema = z.object({
  analyses: z.array(z.unknown()).min(1).max(100),
  overwriteProtected: z.boolean().default(false),
}).strict();

export const analysisImportResultSchema = z.object({
  source: z.string(),
  referenceId: z.uuid().nullable(),
  status: z.enum(["imported", "failed"]),
  preservedFields: protectedFieldsSchema,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
}).strict();

export type AnalysisImportResult = z.infer<typeof analysisImportResultSchema>;

export const analysisImportReportSchema = z.object({
  imported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(analysisImportResultSchema),
}).strict();

export type AnalysisImportReport = z.infer<typeof analysisImportReportSchema>;

export const pendingAnalysisManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  resultsDirectory: z.string(),
  analysisSchema: z.record(z.string(), z.unknown()),
  designTypes: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
  references: z.array(z.object({
    referenceId: z.uuid(),
    title: z.string(),
    sourceUrl: z.string().nullable(),
    imagePath: z.string(),
    protectedFields: protectedFieldsSchema,
  })),
  unavailable: z.array(z.object({ referenceId: z.uuid(), message: z.string() })),
}).strict();

export type PendingAnalysisManifest = z.infer<typeof pendingAnalysisManifestSchema>;
