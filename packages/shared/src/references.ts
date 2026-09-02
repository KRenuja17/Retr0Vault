import { z } from "zod";

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

const nullableOptionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional(),
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
export const protectedFieldsSchema = z.array(protectedFieldSchema).max(10);

export const updateReferenceSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    sourceUrl: z.union([z.url(), z.null()]).optional(),
    designTypeId: z.union([z.uuid(), z.null()]).optional(),
    designDNA: optionalNullableText(1_000).optional(),
    designThesis: optionalNullableText(5_000).optional(),
    designBrief: optionalNullableText(20_000).optional(),
    imageRecipe: optionalNullableText(20_000).optional(),
    motionBrief: optionalNullableText(20_000).optional(),
    assetBrief: optionalNullableText(20_000).optional(),
    analysisStatus: analysisStatusSchema.optional(),
    analysisJson: z.record(z.string(), z.unknown()).nullable().optional(),
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
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type ReferenceResponse = z.infer<typeof referenceResponseSchema>;

export const referenceSortSchema = z.enum([
  "newest",
  "oldest",
  "title-asc",
  "title-desc",
]);

export const referenceListQuerySchema = z
  .object({
    designType: z.string().trim().min(1).max(100).optional(),
    collection: z.string().trim().min(1).max(100).optional(),
    status: analysisStatusSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(24),
    sort: referenceSortSchema.default("newest"),
  })
  .strict();

export type ReferenceListQuery = z.infer<typeof referenceListQuerySchema>;

export const referenceListResponseSchema = z
  .object({
    items: z.array(referenceResponseSchema),
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
