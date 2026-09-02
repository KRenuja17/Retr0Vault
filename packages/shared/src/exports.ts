import { z } from "zod";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const textList = z.array(text(2_000)).max(100);
const selectedIds = z.array(z.uuid().transform((id) => id.toLowerCase())).max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Selected IDs must be unique");

export const referenceExportRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("references"),
    referenceIds: selectedIds.min(1),
  }).strict(),
  z.object({
    mode: z.literal("category-brief"),
    designTypeIds: selectedIds.min(1),
  }).strict(),
  z.object({
    mode: z.literal("vocabulary"),
    referenceIds: selectedIds.default([]),
    designTypeIds: selectedIds.default([]),
  }).strict().refine((value) => value.referenceIds.length + value.designTypeIds.length > 0,
    "Select at least one reference or design type"),
]);

export type ReferenceExportRequest = z.infer<typeof referenceExportRequestSchema>;

export const directionDimensionSchema = z.enum([
  "typography", "layout", "colour", "textureImagery", "uiTreatment", "motion",
]);
export type DirectionDimension = z.infer<typeof directionDimensionSchema>;

export const authoredDirectionSchema = z.object({
  title: text(300),
  designDNA: text(1_000),
  designThesis: text(5_000),
  vocabulary: textList,
  dimensions: z.object({
    typography: text(5_000),
    layout: text(5_000),
    colour: text(5_000),
    textureImagery: text(5_000),
    uiTreatment: text(5_000),
    motion: text(5_000),
  }).strict(),
  borrowings: z.array(z.object({
    referenceId: z.uuid().transform((id) => id.toLowerCase()),
    borrow: text(5_000),
  }).strict()).min(1).max(100),
  authority: z.array(z.object({
    dimension: directionDimensionSchema,
    referenceId: z.uuid().transform((id) => id.toLowerCase()),
    decision: text(5_000),
  }).strict()).length(6).refine((entries) => new Set(entries.map((entry) => entry.dimension)).size === 6,
    "Assign authority exactly once for each design dimension"),
  conflicts: z.array(z.object({
    conflict: text(5_000),
    resolution: text(5_000),
  }).strict()).max(100),
  antiPatterns: textList.min(1),
  designBrief: text(20_000),
  imageRecipes: z.array(text(20_000).regex(/\[SUBJECT\]/u,
    "Image recipes must include [SUBJECT]")).max(20),
}).strict();

export type AuthoredDirection = z.infer<typeof authoredDirectionSchema>;

// The same schema is included in pending manifests so the result can be posted
// directly to the export endpoint. Direction export does not persist a new object.
export const authoredDirectionExportRequestSchema = z.object({
  mode: z.literal("authored"),
  referenceIds: selectedIds.min(1),
  direction: authoredDirectionSchema,
}).strict().superRefine((input, context) => {
  const selected = new Set(input.referenceIds);
  const borrowed = input.direction.borrowings.map((entry) => entry.referenceId);
  if (borrowed.length !== selected.size || new Set(borrowed).size !== selected.size ||
      borrowed.some((id) => !selected.has(id))) {
    context.addIssue({ code: "custom", path: ["direction", "borrowings"],
      message: "Specify what to borrow exactly once for every selected reference" });
  }
  input.direction.authority.forEach((entry, index) => {
    if (!selected.has(entry.referenceId)) {
      context.addIssue({ code: "custom", path: ["direction", "authority", index, "referenceId"],
        message: "Authority must belong to a selected reference" });
    }
  });
});

export const designDirectionExportRequestSchema = z.discriminatedUnion("mode", [
  authoredDirectionExportRequestSchema,
  z.object({
    mode: z.literal("pending-combination"),
    referenceIds: selectedIds.min(2),
    intent: text(5_000).optional(),
  }).strict(),
]);

export type DesignDirectionExportRequest = z.infer<typeof designDirectionExportRequestSchema>;

export const authoredDirectionExportJsonSchema = z.toJSONSchema(authoredDirectionExportRequestSchema, {
  target: "draft-2020-12",
  io: "input",
});
