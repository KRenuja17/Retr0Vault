import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
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
  // JSON object/protected-field validity is enforced by the custom 0006 SQL
  // triggers, which avoid rebuilding this FTS-indexed table during upgrades.
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


// Motion studies: recordings attached to a reference, analysed for motion.
// Evidence and analysis JSON validity is guarded by CHECK constraints here, so
// the tables never need a rebuild-and-copy migration.
export const motionStudies = sqliteTable("motion_studies", {
  id: text("id").primaryKey(),
  referenceId: text("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
  motionStatus: text("motion_status", { enum: ["pending", "analyzed", "manual", "failed"] }).notNull().default("pending"),
  motionDNA: text("motion_dna"),
  motionThesis: text("motion_thesis"),
  motionBrief: text("motion_brief"),
  motionAnalysisJson: text("motion_analysis_json"),
  beatsJson: text("beats_json"),
  implementationJson: text("implementation_json"),
  inspectionNotes: text("inspection_notes"),
  verifiedTechJson: text("verified_tech_json").notNull().default("[]"),
  protectedFields: text("protected_fields").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("motion_studies_reference_unique").on(table.referenceId),
  index("motion_studies_status_index").on(table.motionStatus),
  check("motion_studies_status_check", sql`${table.motionStatus} in ('pending', 'analyzed', 'manual', 'failed')`),
  check("motion_studies_analysis_json_check", sql`${table.motionAnalysisJson} is null or (json_valid(${table.motionAnalysisJson}) and json_type(${table.motionAnalysisJson}) = 'object')`),
  check("motion_studies_beats_json_check", sql`${table.beatsJson} is null or (json_valid(${table.beatsJson}) and json_type(${table.beatsJson}) = 'array')`),
  check("motion_studies_implementation_json_check", sql`${table.implementationJson} is null or (json_valid(${table.implementationJson}) and json_type(${table.implementationJson}) = 'array')`),
  check("motion_studies_verified_tech_check", sql`json_valid(${table.verifiedTechJson}) and json_type(${table.verifiedTechJson}) = 'array'`),
  check("motion_studies_protected_fields_check", sql`json_valid(${table.protectedFields}) and json_type(${table.protectedFields}) = 'array'`),
]);

export const motionClips = sqliteTable("motion_clips", {
  id: text("id").primaryKey(),
  motionStudyId: text("motion_study_id").notNull().references(() => motionStudies.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  processingStatus: text("processing_status", { enum: ["queued", "processing", "ready", "failed"] }).notNull().default("queued"),
  processingError: text("processing_error"),
  sourceFormat: text("source_format"),
  posterMs: integer("poster_ms").notNull().default(1000),
  durationMs: integer("duration_ms"),
  width: integer("width"),
  height: integer("height"),
  fps: real("fps"),
  bytes: integer("bytes"),
  evidenceJson: text("evidence_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("motion_clips_order_unique").on(table.motionStudyId, table.sortOrder),
  index("motion_clips_status_index").on(table.processingStatus),
  check("motion_clips_status_check", sql`${table.processingStatus} in ('queued', 'processing', 'ready', 'failed')`),
  check("motion_clips_label_check", sql`length(trim(${table.label})) between 1 and 60`),
  check("motion_clips_order_check", sql`${table.sortOrder} >= 0`),
  check("motion_clips_poster_check", sql`${table.posterMs} >= 0`),
  check("motion_clips_evidence_json_check", sql`${table.evidenceJson} is null or (json_valid(${table.evidenceJson}) and json_type(${table.evidenceJson}) = 'object')`),
  check("motion_clips_ready_check", sql`${table.processingStatus} <> 'ready' or (${table.durationMs} > 0 and ${table.width} > 0 and ${table.height} > 0 and ${table.evidenceJson} is not null)`),
]);

export const motionKeyframes = sqliteTable("motion_keyframes", {
  id: text("id").primaryKey(),
  motionClipId: text("motion_clip_id").notNull().references(() => motionClips.id, { onDelete: "cascade" }),
  timeMs: integer("time_ms").notNull(),
  reason: text("reason", { enum: ["start", "onset", "peak", "settle", "cut", "fill", "end"] }).notNull(),
  imagePath: text("image_path").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  uniqueIndex("motion_keyframes_order_unique").on(table.motionClipId, table.sortOrder),
  uniqueIndex("motion_keyframes_path_unique").on(table.imagePath),
  check("motion_keyframes_reason_check", sql`${table.reason} in ('start', 'onset', 'peak', 'settle', 'cut', 'fill', 'end')`),
  check("motion_keyframes_time_check", sql`${table.timeMs} >= 0`),
  check("motion_keyframes_order_check", sql`${table.sortOrder} >= 0`),
]);

// Motion tags are kept apart from reference tags: reference edits garbage-
// collect unused rows in `tags`, which would silently drop motion-only terms.
export const motionStudyTags = sqliteTable("motion_study_tags", {
  motionStudyId: text("motion_study_id").notNull().references(() => motionStudies.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  value: text("value").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  primaryKey({ columns: [table.motionStudyId, table.type, table.normalizedValue] }),
  uniqueIndex("motion_study_tags_order_unique").on(table.motionStudyId, table.sortOrder),
  index("motion_study_tags_value_index").on(table.type, table.normalizedValue),
  check("motion_study_tags_type_check", sql`${table.type} in ('trigger', 'technique', 'transition', 'easing', 'pacing', 'camera', 'interaction', 'type-motion', 'rendering')`),
  check("motion_study_tags_value_check", sql`length(trim(${table.value})) > 0 and length(trim(${table.normalizedValue})) > 0`),
  check("motion_study_tags_order_check", sql`${table.sortOrder} >= 0`),
]);

export const databaseSchema = {
  appMetadata,
  collectionReferences,
  motionClips,
  motionKeyframes,
  motionStudies,
  motionStudyTags,
  collections,
  designTypeRules,
  designTypeVocabulary,
  designTypes,
  referenceTags,
  referenceFrames,
  references,
  tags,
};
