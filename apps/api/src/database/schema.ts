import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const designTypes = sqliteTable(
  "design_types",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    deployFor: text("deploy_for").notNull(),
    risk: text("risk").notNull(),
    briefBlock: text("brief_block").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("design_types_slug_unique").on(table.slug),
    index("design_types_sort_order_index").on(table.sortOrder),
    check("design_types_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const designTypeRules = sqliteTable(
  "design_type_rules",
  {
    id: text("id").primaryKey(),
    designTypeId: text("design_type_id")
      .notNull()
      .references(() => designTypes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["principle", "avoid"] }).notNull(),
    text: text("text").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("design_type_rules_design_type_index").on(table.designTypeId),
    uniqueIndex("design_type_rules_order_unique").on(
      table.designTypeId,
      table.kind,
      table.sortOrder,
    ),
    check(
      "design_type_rules_kind_check",
      sql`${table.kind} in ('principle', 'avoid')`,
    ),
    check(
      "design_type_rules_text_nonempty",
      sql`length(trim(${table.text})) > 0`,
    ),
    check(
      "design_type_rules_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const designTypeVocabulary = sqliteTable(
  "design_type_vocabulary",
  {
    id: text("id").primaryKey(),
    designTypeId: text("design_type_id")
      .notNull()
      .references(() => designTypes.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("design_type_vocabulary_design_type_index").on(table.designTypeId),
    uniqueIndex("design_type_vocabulary_order_unique").on(
      table.designTypeId,
      table.sortOrder,
    ),
    uniqueIndex("design_type_vocabulary_term_unique").on(
      table.designTypeId,
      table.term,
    ),
    check(
      "design_type_vocabulary_term_nonempty",
      sql`length(trim(${table.term})) > 0`,
    ),
    check(
      "design_type_vocabulary_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("collections_slug_unique").on(table.slug),
    index("collections_sort_order_index").on(table.sortOrder),
    check("collections_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const references = sqliteTable(
  "references",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    sourceType: text("source_type", { enum: ["image", "website"] }).notNull(),
    sourceUrl: text("source_url"),
    originalPath: text("original_path").notNull(),
    thumbnailPath: text("thumbnail_path").notNull(),
    designTypeId: text("design_type_id").references(() => designTypes.id, {
      onDelete: "restrict",
    }),
    designDNA: text("design_dna"),
    designThesis: text("design_thesis"),
    designBrief: text("design_brief"),
    imageRecipe: text("image_recipe"),
    motionBrief: text("motion_brief"),
    assetBrief: text("asset_brief"),
    analysisStatus: text("analysis_status", {
      enum: ["pending", "analyzed", "manual", "failed"],
    })
      .notNull()
      .default("pending"),
    analysisJson: text("analysis_json"),
    protectedFields: text("protected_fields").notNull().default("[]"),
    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),
    imageFormat: text("image_format", {
      enum: ["jpeg", "png", "webp"],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("references_design_type_index").on(table.designTypeId),
    index("references_analysis_status_index").on(table.analysisStatus),
    index("references_created_at_index").on(table.createdAt),
    check(
      "references_source_type_check",
      sql`${table.sourceType} in ('image', 'website')`,
    ),
    check(
      "references_analysis_status_check",
      sql`${table.analysisStatus} in ('pending', 'analyzed', 'manual', 'failed')`,
    ),
    check("references_title_nonempty", sql`length(trim(${table.title})) > 0`),
    check(
      "references_original_path_nonempty",
      sql`length(trim(${table.originalPath})) > 0`,
    ),
    check(
      "references_thumbnail_path_nonempty",
      sql`length(trim(${table.thumbnailPath})) > 0`,
    ),
    check("references_image_width_positive", sql`${table.imageWidth} > 0`),
    check("references_image_height_positive", sql`${table.imageHeight} > 0`),
    check(
      "references_image_format_check",
      sql`${table.imageFormat} in ('jpeg', 'png', 'webp')`,
    ),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
  },
  (table) => [
    uniqueIndex("tags_type_normalized_value_unique").on(
      table.type,
      table.normalizedValue,
    ),
    check("tags_type_nonempty", sql`length(trim(${table.type})) > 0`),
    check("tags_value_nonempty", sql`length(trim(${table.value})) > 0`),
    check(
      "tags_normalized_value_nonempty",
      sql`length(trim(${table.normalizedValue})) > 0`,
    ),
  ],
);

export const referenceTags = sqliteTable(
  "reference_tags",
  {
    referenceId: text("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.referenceId, table.tagId] }),
    uniqueIndex("reference_tags_order_unique").on(
      table.referenceId,
      table.sortOrder,
    ),
    index("reference_tags_tag_index").on(table.tagId),
    check("reference_tags_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const collectionReferences = sqliteTable(
  "collection_references",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    referenceId: text("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.referenceId] }),
    index("collection_references_order_index").on(
      table.collectionId,
      table.sortOrder,
    ),
    index("collection_references_reference_index").on(table.referenceId),
    check(
      "collection_references_sort_order_nonnegative",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const referenceFrames = sqliteTable("reference_frames", {
  id: text("id").primaryKey(),
  referenceId: text("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
  frameType: text("frame_type", { enum: ["viewport", "hero", "scroll", "fullpage"] }).notNull(),
  imagePath: text("image_path").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  uniqueIndex("reference_frames_order_unique").on(table.referenceId, table.sortOrder),
  uniqueIndex("reference_frames_path_unique").on(table.imagePath),
  check("reference_frames_type_check", sql`${table.frameType} in ('viewport', 'hero', 'scroll', 'fullpage')`),
  check("reference_frames_order_nonnegative", sql`${table.sortOrder} >= 0`),
  check("reference_frames_path_nonempty", sql`length(trim(${table.imagePath})) > 0`),
]);

export const databaseSchema = {
  appMetadata,
  collectionReferences,
  collections,
  designTypeRules,
  designTypeVocabulary,
  designTypes,
  referenceTags,
  referenceFrames,
  references,
  tags,
};
