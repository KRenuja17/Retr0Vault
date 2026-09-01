import { z } from "zod";

const requiredText = (field: string, maximum: number) =>
  z
    .string({ error: `${field} must be text` })
    .trim()
    .min(1, `${field} cannot be empty`)
    .max(maximum, `${field} must be at most ${maximum} characters`);

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug cannot be empty")
  .max(100, "Slug must be at most 100 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must contain lowercase letters, numbers, and single hyphens only",
  );

const orderedTextList = (label: string) =>
  z
    .array(requiredText(label, 500))
    .max(100, `At most 100 ${label.toLowerCase()} entries are allowed`)
    .superRefine((values, context) => {
      const normalizedValues = new Set<string>();

      values.forEach((value, index) => {
        const normalizedValue = value.toLocaleLowerCase("en-US");
        if (normalizedValues.has(normalizedValue)) {
          context.addIssue({
            code: "custom",
            message: `${label} entries must be unique`,
            path: [index],
          });
        }
        normalizedValues.add(normalizedValue);
      });
    });

const designTypeFields = {
  name: requiredText("Name", 120),
  slug: slugSchema,
  description: requiredText("Description", 2_000),
  deployFor: requiredText("Deploy for", 1_000),
  risk: requiredText("Risk", 1_000),
  briefBlock: requiredText("Brief block", 5_000),
  sortOrder: z.number().int().min(0).max(1_000_000),
  principles: orderedTextList("Principle"),
  avoid: orderedTextList("Avoid rule"),
  vocabulary: orderedTextList("Vocabulary term"),
};

export const createDesignTypeSchema = z
  .object({
    name: designTypeFields.name,
    slug: designTypeFields.slug.optional(),
    description: designTypeFields.description,
    deployFor: designTypeFields.deployFor,
    risk: designTypeFields.risk,
    briefBlock: designTypeFields.briefBlock,
    sortOrder: designTypeFields.sortOrder.optional(),
    principles: designTypeFields.principles.optional().default([]),
    avoid: designTypeFields.avoid.optional().default([]),
    vocabulary: designTypeFields.vocabulary.optional().default([]),
  })
  .strict();

export type CreateDesignTypeInput = z.infer<typeof createDesignTypeSchema>;

export const updateDesignTypeSchema = z
  .object({
    name: designTypeFields.name.optional(),
    slug: designTypeFields.slug.optional(),
    description: designTypeFields.description.optional(),
    deployFor: designTypeFields.deployFor.optional(),
    risk: designTypeFields.risk.optional(),
    briefBlock: designTypeFields.briefBlock.optional(),
    sortOrder: designTypeFields.sortOrder.optional(),
    principles: designTypeFields.principles.optional(),
    avoid: designTypeFields.avoid.optional(),
    vocabulary: designTypeFields.vocabulary.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateDesignTypeInput = z.infer<typeof updateDesignTypeSchema>;

export const designTypeResponseSchema = z
  .object({
    id: z.uuid(),
    slug: slugSchema,
    name: z.string(),
    description: z.string(),
    deployFor: z.string(),
    risk: z.string(),
    briefBlock: z.string(),
    sortOrder: z.number().int().min(0),
    principles: z.array(z.string()),
    avoid: z.array(z.string()),
    vocabulary: z.array(z.string()),
    referenceCount: z.number().int().min(0),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type DesignTypeResponse = z.infer<typeof designTypeResponseSchema>;

export const designTypeListResponseSchema = z.array(designTypeResponseSchema);
