import { z } from "zod";

import { slugSchema } from "./design-types.js";

const collectionNameSchema = z
  .string()
  .trim()
  .min(1, "Name cannot be empty")
  .max(120, "Name must be at most 120 characters");

const collectionDescriptionSchema = z
  .string()
  .trim()
  .max(2_000, "Description must be at most 2000 characters");

const collectionSortOrderSchema = z
  .number()
  .int()
  .min(0)
  .max(1_000_000);

export const createCollectionSchema = z
  .object({
    name: collectionNameSchema,
    slug: slugSchema.optional(),
    description: collectionDescriptionSchema.optional().default(""),
    isPinned: z.boolean().optional().default(false),
    sortOrder: collectionSortOrderSchema.optional(),
  })
  .strict();

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z
  .object({
    name: collectionNameSchema.optional(),
    slug: slugSchema.optional(),
    description: collectionDescriptionSchema.optional(),
    isPinned: z.boolean().optional(),
    sortOrder: collectionSortOrderSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

export const collectionResponseSchema = z
  .object({
    id: z.uuid(),
    slug: slugSchema,
    name: z.string(),
    description: z.string(),
    isPinned: z.boolean(),
    sortOrder: z.number().int().min(0),
    referenceCount: z.number().int().min(0),
  })
  .strict();

export type CollectionResponse = z.infer<typeof collectionResponseSchema>;

export const collectionListResponseSchema = z.array(collectionResponseSchema);
