import { z } from "zod";
import { referenceFrameSchema } from "./capture.js";

export const sourceTypeSchema = z.enum(["image", "website"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const analysisStatusSchema = z.enum([
  "pending",
  "analyzed",
  "manual",
  "failed",
]);
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const imageFormatSchema = z.enum(["jpeg", "png", "webp"]);
export type ImageFormat = z.infer<typeof imageFormatSchema>;

// Metadata links are never fetched, but must be safe to render as links later.
export const sourceUrlSchema = z.string().max(2_048)
  .regex(/^https?:\/\/[^\s\\\u0000-\u001f\u007f]+$/iu, "Use an HTTP(S) URL without whitespace or backslashes")
  .pipe(z.url()).refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "URL credentials are not allowed");

const nullableOptionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  sourceUrlSchema.optional(),
);

const nullableOptionalUuid = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.uuid().optional(),
);

export const createImageReferenceFieldsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be empty")
      .max(300)
      .optional()
      .default("Untitled Reference"),
    sourceUrl: nullableOptionalUrl,
    designTypeId: nullableOptionalUuid,
  })
  .strict();

export type CreateImageReferenceFields = z.infer<
  typeof createImageReferenceFieldsSchema
>;

export const referenceTagInputSchema = z
  .object({
    type: z.string().trim().min(1).max(50),
    value: z.string().trim().min(1).max(300),
  })
  .strict();

export type ReferenceTagInput = z.infer<typeof referenceTagInputSchema>;

export const referenceTagResponseSchema = referenceTagInputSchema.extend({
  id: z.uuid(),
  normalizedValue: z.string().min(1),
  sortOrder: z.number().int().min(0),
});

export type ReferenceTagResponse = z.infer<
  typeof referenceTagResponseSchema
>;

const optionalNullableText = (maximum: number) =>
  z.union([z.string().trim().max(maximum), z.null()]);

export const protectedFieldSchema = z.enum([
  "title", "designTypeId", "designDNA", "designThesis", "designBrief",
  "imageRecipe", "motionBrief", "assetBrief", "analysisJson", "tags",
]);
export type ProtectedField = z.infer<typeof protectedFieldSchema>;
export const protectedFieldsSchema = z.array(protectedFieldSchema).max(10)
  .refine((fields) => new Set(fields).size === fields.length, "Protected fields must be unique");

export const boundedAnalysisJsonSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (++nodes > 10_000 || item.depth > 20) {
      context.addIssue({ code: "custom", message: "Analysis JSON exceeds 20 nesting levels or 10,000 values" });
      return;
    }
    if (item.value !== null && typeof item.value === "object") {
      for (const child of Object.values(item.value)) pending.push({ value: child, depth: item.depth + 1 });
    } else if (item.value !== null && !["string", "number", "boolean"].includes(typeof item.value)) {
      context.addIssue({ code: "custom", message: "Analysis must contain JSON values only" });
      return;
    }
  }
});

export const updateReferenceSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    sourceUrl: z.union([sourceUrlSchema, z.null()]).optional(),
    designTypeId: z.union([z.uuid(), z.null()]).optional(),
    designDNA: optionalNullableText(1_000).optional(),
    designThesis: optionalNullableText(5_000).optional(),
    designBrief: optionalNullableText(20_000).optional(),
    imageRecipe: optionalNullableText(20_000).optional(),
    motionBrief: optionalNullableText(20_000).optional(),
    assetBrief: optionalNullableText(20_000).optional(),
    analysisStatus: analysisStatusSchema.optional(),
    analysisJson: boundedAnalysisJsonSchema.nullable().optional(),
    tags: z.array(referenceTagInputSchema).max(200).optional(),
    collectionIds: z.array(z.uuid()).max(200).optional(),
    protectedFields: protectedFieldsSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateReferenceInput = z.infer<typeof updateReferenceSchema>;

export const referenceResponseSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    sourceType: sourceTypeSchema,
    sourceUrl: z.string().nullable(),
    originalPath: z.string(),
    thumbnailPath: z.string(),
    designTypeId: z.uuid().nullable(),
    designDNA: z.string().nullable(),
    designThesis: z.string().nullable(),
    designBrief: z.string().nullable(),
    imageRecipe: z.string().nullable(),
    motionBrief: z.string().nullable(),
    assetBrief: z.string().nullable(),
    analysisStatus: analysisStatusSchema,
    analysisJson: z.record(z.string(), z.unknown()).nullable(),
    protectedFields: protectedFieldsSchema,
    image: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      format: imageFormatSchema,
    }),
    tags: z.array(referenceTagResponseSchema),
    collectionIds: z.array(z.uuid()),
    frames: z.array(referenceFrameSchema).default([]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type ReferenceResponse = z.infer<typeof referenceResponseSchema>;

export const referenceSortSchema = z.enum([
  "relevance",
  "newest",
  "oldest",
  "title-asc",
  "title-desc",
]);

export const referenceListQuerySchema = z
  .object({
    q: z.string().trim().max(500).optional(),
    designType: z.string().trim().min(1).max(100).optional(),
    collection: z.string().trim().min(1).max(100).optional(),
    status: analysisStatusSchema.optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    sort: referenceSortSchema.optional(),
    includeCatalogueIndex: z.enum(["true", "false"])
      .transform((value) => value === "true").default(false),
  })
  .strict()
  .transform((value) => ({
    ...value,
    sort: value.sort ?? (value.q ? "relevance" : "newest"),
  }));

export type ReferenceListQuery = z.infer<typeof referenceListQuerySchema>;

export const referenceListItemSchema = referenceResponseSchema.extend({
  catalogueIndex: z.number().int().positive().optional(),
});

export const referenceListResponseSchema = z
  .object({
    items: z.array(referenceListItemSchema),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })
  .strict();

export type ReferenceListResponse = z.infer<
  typeof referenceListResponseSchema
>;

export const collectionMembershipInputSchema = z
  .object({
    sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();
