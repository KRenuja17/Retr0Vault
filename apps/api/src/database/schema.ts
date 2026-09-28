import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Retr0Vault on Postgres (Phase C). A column-for-column port of the SQLite
 * schema in `../schema.ts`, with native types where Postgres has them:
 *
 * - identifiers are `uuid`
 * - times are `timestamptz`, read and written as JavaScript Dates
 * - JSON documents are `jsonb`, shape-checked by CHECK constraints (the SQLite
 *   schema needed triggers for this); the protected-field lists are checked by
 *   `rv_valid_name_set`, defined in the 0001 migration
 * - flags are `boolean`
 *
 * Names of tables, columns, indexes and constraints are unchanged, so services,
 * error mapping and the data migration can rely on them.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const appMetadata = pgTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
}).enableRLS();

/*
 * Accounts. A username is matched without regard to case (`username_key`);
 * the password is stored only as an scrypt hash. A session row holds the
 * SHA-256 of the token in the browser's cookie, never the token itself.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    username: text("username").notNull(),
    usernameKey: text("username_key").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_username_key_unique").on(table.usernameKey),
    check("users_username_check", sql`${table.username} ~ '^[A-Za-z0-9._-]{3,32}$'`),
    check("users_username_key_check", sql`${table.usernameKey} = lower(${table.username})`),
    check("users_password_hash_check", sql`${table.passwordHash} like 'scrypt$%'`),
  ],
).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("sessions_user_index").on(table.userId),
    index("sessions_expires_at_index").on(table.expiresAt),
    check("sessions_token_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
).enableRLS();

export const designTypes = pgTable(
  "design_types",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    deployFor: text("deploy_for").notNull(),
    risk: text("risk").notNull(),
    briefBlock: text("brief_block").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("design_types_slug_unique").on(table.slug),
    index("design_types_sort_order_index").on(table.sortOrder),
    check("design_types_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const designTypeRules = pgTable(
  "design_type_rules",
  {
    id: uuid("id").primaryKey(),
    designTypeId: uuid("design_type_id")
      .notNull()
      .references(() => designTypes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["principle", "avoid"] }).notNull(),
    text: text("text").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("design_type_rules_design_type_index").on(table.designTypeId),
    uniqueIndex("design_type_rules_order_unique").on(table.designTypeId, table.kind, table.sortOrder),
    check("design_type_rules_kind_check", sql`${table.kind} in ('principle', 'avoid')`),
    check("design_type_rules_text_nonempty", sql`length(trim(${table.text})) > 0`),
    check("design_type_rules_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const designTypeVocabulary = pgTable(
  "design_type_vocabulary",
  {
    id: uuid("id").primaryKey(),
    designTypeId: uuid("design_type_id")
      .notNull()
      .references(() => designTypes.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    index("design_type_vocabulary_design_type_index").on(table.designTypeId),
    uniqueIndex("design_type_vocabulary_order_unique").on(table.designTypeId, table.sortOrder),
    uniqueIndex("design_type_vocabulary_term_unique").on(table.designTypeId, table.term),
    check("design_type_vocabulary_term_nonempty", sql`length(trim(${table.term})) > 0`),
    check("design_type_vocabulary_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    isPinned: boolean("is_pinned").notNull().default(false),
    sortOrder: integer("sort_order").notNull(),
    /** The account the collection belongs to; unowned rows are visible to no account. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    // Each account names its own collections.
    uniqueIndex("collections_owner_slug_unique").on(table.ownerId, table.slug),
    index("collections_owner_index").on(table.ownerId),
    index("collections_sort_order_index").on(table.sortOrder),
    check("collections_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const references = pgTable(
  "references",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    sourceType: text("source_type", { enum: ["image", "website"] }).notNull(),
    sourceUrl: text("source_url"),
    originalPath: text("original_path").notNull(),
    thumbnailPath: text("thumbnail_path").notNull(),
    designTypeId: uuid("design_type_id").references(() => designTypes.id, { onDelete: "restrict" }),
    designDNA: text("design_dna"),
    designThesis: text("design_thesis"),
    designBrief: text("design_brief"),
    imageRecipe: text("image_recipe"),
    motionBrief: text("motion_brief"),
    assetBrief: text("asset_brief"),
    analysisStatus: text("analysis_status", { enum: ["pending", "analyzed", "manual", "failed"] })
      .notNull()
      .default("pending"),
    analysisJson: jsonb("analysis_json"),
    // Checked against the ten protectable names by `references_protected_fields_check` (0001).
    protectedFields: jsonb("protected_fields").notNull().default(sql`'[]'::jsonb`),
    imageWidth: integer("image_width").notNull(),
    imageHeight: integer("image_height").notNull(),
    imageFormat: text("image_format", { enum: ["jpeg", "png", "webp"] }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** The account the reference belongs to; unowned rows are visible to no account. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [
    index("references_owner_index").on(table.ownerId),
    index("references_design_type_index").on(table.designTypeId),
    index("references_analysis_status_index").on(table.analysisStatus),
    index("references_created_at_index").on(table.createdAt),
    check("references_source_type_check", sql`${table.sourceType} in ('image', 'website')`),
    check("references_analysis_status_check", sql`${table.analysisStatus} in ('pending', 'analyzed', 'manual', 'failed')`),
    check("references_title_nonempty", sql`length(trim(${table.title})) > 0`),
    check("references_original_path_nonempty", sql`length(trim(${table.originalPath})) > 0`),
    check("references_thumbnail_path_nonempty", sql`length(trim(${table.thumbnailPath})) > 0`),
    check("references_image_width_positive", sql`${table.imageWidth} > 0`),
    check("references_image_height_positive", sql`${table.imageHeight} > 0`),
    check("references_image_format_check", sql`${table.imageFormat} in ('jpeg', 'png', 'webp')`),
    check("references_analysis_json_check", sql`${table.analysisJson} is null or jsonb_typeof(${table.analysisJson}) = 'object'`),
  ],
).enableRLS();

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
  },
  (table) => [
    uniqueIndex("tags_type_normalized_value_unique").on(table.type, table.normalizedValue),
    check("tags_type_nonempty", sql`length(trim(${table.type})) > 0`),
    check("tags_value_nonempty", sql`length(trim(${table.value})) > 0`),
    check("tags_normalized_value_nonempty", sql`length(trim(${table.normalizedValue})) > 0`),
  ],
).enableRLS();

export const referenceTags = pgTable(
  "reference_tags",
  {
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.referenceId, table.tagId] }),
    uniqueIndex("reference_tags_order_unique").on(table.referenceId, table.sortOrder),
    index("reference_tags_tag_index").on(table.tagId),
    check("reference_tags_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const collectionReferences = pgTable(
  "collection_references",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.referenceId] }),
    index("collection_references_order_index").on(table.collectionId, table.sortOrder),
    index("collection_references_reference_index").on(table.referenceId),
    check("collection_references_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const referenceFrames = pgTable(
  "reference_frames",
  {
    id: uuid("id").primaryKey(),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    frameType: text("frame_type", { enum: ["viewport", "hero", "scroll", "fullpage"] }).notNull(),
    imagePath: text("image_path").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("reference_frames_order_unique").on(table.referenceId, table.sortOrder),
    uniqueIndex("reference_frames_path_unique").on(table.imagePath),
    check("reference_frames_type_check", sql`${table.frameType} in ('viewport', 'hero', 'scroll', 'fullpage')`),
    check("reference_frames_order_nonnegative", sql`${table.sortOrder} >= 0`),
    check("reference_frames_path_nonempty", sql`length(trim(${table.imagePath})) > 0`),
  ],
).enableRLS();

// Motion studies: recordings attached to a reference, analysed for motion.
export const motionStudies = pgTable(
  "motion_studies",
  {
    id: uuid("id").primaryKey(),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => references.id, { onDelete: "cascade" }),
    motionStatus: text("motion_status", { enum: ["pending", "analyzed", "manual", "failed"] })
      .notNull()
      .default("pending"),
    motionDNA: text("motion_dna"),
    motionThesis: text("motion_thesis"),
    motionBrief: text("motion_brief"),
    motionAnalysisJson: jsonb("motion_analysis_json"),
    beatsJson: jsonb("beats_json"),
    implementationJson: jsonb("implementation_json"),
    inspectionNotes: text("inspection_notes"),
    verifiedTechJson: jsonb("verified_tech_json").notNull().default(sql`'[]'::jsonb`),
    // Checked against the seven protectable names by `motion_studies_protected_fields_check` (0001).
    protectedFields: jsonb("protected_fields").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("motion_studies_reference_unique").on(table.referenceId),
    index("motion_studies_status_index").on(table.motionStatus),
    check("motion_studies_status_check", sql`${table.motionStatus} in ('pending', 'analyzed', 'manual', 'failed')`),
    check("motion_studies_analysis_json_check", sql`${table.motionAnalysisJson} is null or jsonb_typeof(${table.motionAnalysisJson}) = 'object'`),
    check("motion_studies_beats_json_check", sql`${table.beatsJson} is null or jsonb_typeof(${table.beatsJson}) = 'array'`),
    check("motion_studies_implementation_json_check", sql`${table.implementationJson} is null or jsonb_typeof(${table.implementationJson}) = 'array'`),
    check("motion_studies_verified_tech_check", sql`jsonb_typeof(${table.verifiedTechJson}) = 'array'`),
  ],
).enableRLS();

export const motionClips = pgTable(
  "motion_clips",
  {
    id: uuid("id").primaryKey(),
    motionStudyId: uuid("motion_study_id")
      .notNull()
      .references(() => motionStudies.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull(),
    processingStatus: text("processing_status", { enum: ["queued", "processing", "ready", "failed"] })
      .notNull()
      .default("queued"),
    processingError: text("processing_error"),
    sourceFormat: text("source_format"),
    posterMs: integer("poster_ms").notNull().default(1000),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    fps: doublePrecision("fps"),
    bytes: bigint("bytes", { mode: "number" }),
    evidenceJson: jsonb("evidence_json"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("motion_clips_order_unique").on(table.motionStudyId, table.sortOrder),
    index("motion_clips_status_index").on(table.processingStatus),
    check("motion_clips_status_check", sql`${table.processingStatus} in ('queued', 'processing', 'ready', 'failed')`),
    check("motion_clips_label_check", sql`length(trim(${table.label})) between 1 and 60`),
    check("motion_clips_order_check", sql`${table.sortOrder} >= 0`),
    check("motion_clips_poster_check", sql`${table.posterMs} >= 0`),
    check("motion_clips_evidence_json_check", sql`${table.evidenceJson} is null or jsonb_typeof(${table.evidenceJson}) = 'object'`),
    check(
      "motion_clips_ready_check",
      sql`${table.processingStatus} <> 'ready' or (${table.durationMs} > 0 and ${table.width} > 0 and ${table.height} > 0 and ${table.evidenceJson} is not null)`,
    ),
  ],
).enableRLS();

export const motionKeyframes = pgTable(
  "motion_keyframes",
  {
    id: uuid("id").primaryKey(),
    motionClipId: uuid("motion_clip_id")
      .notNull()
      .references(() => motionClips.id, { onDelete: "cascade" }),
    timeMs: integer("time_ms").notNull(),
    reason: text("reason", { enum: ["start", "onset", "peak", "settle", "cut", "fill", "end"] }).notNull(),
    imagePath: text("image_path").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("motion_keyframes_order_unique").on(table.motionClipId, table.sortOrder),
    uniqueIndex("motion_keyframes_path_unique").on(table.imagePath),
    check("motion_keyframes_reason_check", sql`${table.reason} in ('start', 'onset', 'peak', 'settle', 'cut', 'fill', 'end')`),
    check("motion_keyframes_time_check", sql`${table.timeMs} >= 0`),
    check("motion_keyframes_order_check", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

// Motion tags are kept apart from reference tags: reference edits garbage-
// collect unused rows in `tags`, which would silently drop motion-only terms.
export const motionStudyTags = pgTable(
  "motion_study_tags",
  {
    motionStudyId: uuid("motion_study_id")
      .notNull()
      .references(() => motionStudies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.motionStudyId, table.type, table.normalizedValue] }),
    uniqueIndex("motion_study_tags_order_unique").on(table.motionStudyId, table.sortOrder),
    index("motion_study_tags_value_index").on(table.type, table.normalizedValue),
    check(
      "motion_study_tags_type_check",
      sql`${table.type} in ('trigger', 'technique', 'transition', 'easing', 'pacing', 'camera', 'interaction', 'type-motion', 'rendering')`,
    ),
    check("motion_study_tags_value_check", sql`length(trim(${table.value})) > 0 and length(trim(${table.normalizedValue})) > 0`),
    check("motion_study_tags_order_check", sql`${table.sortOrder} >= 0`),
  ],
).enableRLS();

export const databaseSchema = {
  appMetadata,
  users,
  sessions,
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
