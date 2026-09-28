-- The pre-cloud SQLite schema (tables only): the format of the archive `cloud:migrate` reads and of the backups `cloud:backup` writes.
CREATE TABLE `design_types` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`deploy_for` text NOT NULL,
	`risk` text NOT NULL,
	`brief_block` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "design_types_sort_order_nonnegative" CHECK("design_types"."sort_order" >= 0)
);
CREATE TABLE `design_type_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`design_type_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`design_type_id`) REFERENCES `design_types`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "design_type_rules_kind_check" CHECK("design_type_rules"."kind" in ('principle', 'avoid')),
	CONSTRAINT "design_type_rules_text_nonempty" CHECK(length(trim("design_type_rules"."text")) > 0),
	CONSTRAINT "design_type_rules_sort_order_nonnegative" CHECK("design_type_rules"."sort_order" >= 0)
);
CREATE TABLE `design_type_vocabulary` (
	`id` text PRIMARY KEY NOT NULL,
	`design_type_id` text NOT NULL,
	`term` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`design_type_id`) REFERENCES `design_types`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "design_type_vocabulary_term_nonempty" CHECK(length(trim("design_type_vocabulary"."term")) > 0),
	CONSTRAINT "design_type_vocabulary_sort_order_nonnegative" CHECK("design_type_vocabulary"."sort_order" >= 0)
);
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "collections_sort_order_nonnegative" CHECK("collections"."sort_order" >= 0)
);
CREATE TABLE `references` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`original_path` text NOT NULL,
	`thumbnail_path` text NOT NULL,
	`design_type_id` text,
	`design_dna` text,
	`design_thesis` text,
	`design_brief` text,
	`image_recipe` text,
	`motion_brief` text,
	`asset_brief` text,
	`analysis_status` text DEFAULT 'pending' NOT NULL,
	`analysis_json` text,
	`image_width` integer NOT NULL,
	`image_height` integer NOT NULL,
	`image_format` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL, `protected_fields` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`design_type_id`) REFERENCES `design_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "references_source_type_check" CHECK("references"."source_type" in ('image', 'website')),
	CONSTRAINT "references_analysis_status_check" CHECK("references"."analysis_status" in ('pending', 'analyzed', 'manual', 'failed')),
	CONSTRAINT "references_title_nonempty" CHECK(length(trim("references"."title")) > 0),
	CONSTRAINT "references_original_path_nonempty" CHECK(length(trim("references"."original_path")) > 0),
	CONSTRAINT "references_thumbnail_path_nonempty" CHECK(length(trim("references"."thumbnail_path")) > 0),
	CONSTRAINT "references_image_width_positive" CHECK("references"."image_width" > 0),
	CONSTRAINT "references_image_height_positive" CHECK("references"."image_height" > 0),
	CONSTRAINT "references_image_format_check" CHECK("references"."image_format" in ('jpeg', 'png', 'webp'))
);
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	CONSTRAINT "tags_type_nonempty" CHECK(length(trim("tags"."type")) > 0),
	CONSTRAINT "tags_value_nonempty" CHECK(length(trim("tags"."value")) > 0),
	CONSTRAINT "tags_normalized_value_nonempty" CHECK(length(trim("tags"."normalized_value")) > 0)
);
CREATE TABLE `reference_tags` (
	`reference_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`reference_id`, `tag_id`),
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reference_tags_sort_order_nonnegative" CHECK("reference_tags"."sort_order" >= 0)
);
CREATE TABLE `collection_references` (
	`collection_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `reference_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "collection_references_sort_order_nonnegative" CHECK("collection_references"."sort_order" >= 0)
);
CREATE TABLE `reference_frames` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_id` text NOT NULL,
	`frame_type` text NOT NULL,
	`image_path` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reference_frames_type_check" CHECK("reference_frames"."frame_type" in ('viewport', 'hero', 'scroll', 'fullpage')),
	CONSTRAINT "reference_frames_order_nonnegative" CHECK("reference_frames"."sort_order" >= 0),
	CONSTRAINT "reference_frames_path_nonempty" CHECK(length(trim("reference_frames"."image_path")) > 0)
);
CREATE TABLE `motion_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_id` text NOT NULL,
	`motion_status` text DEFAULT 'pending' NOT NULL,
	`motion_dna` text,
	`motion_thesis` text,
	`motion_brief` text,
	`motion_analysis_json` text,
	`beats_json` text,
	`implementation_json` text,
	`inspection_notes` text,
	`verified_tech_json` text DEFAULT '[]' NOT NULL,
	`protected_fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "motion_studies_status_check" CHECK("motion_studies"."motion_status" in ('pending', 'analyzed', 'manual', 'failed')),
	CONSTRAINT "motion_studies_analysis_json_check" CHECK("motion_studies"."motion_analysis_json" is null or (json_valid("motion_studies"."motion_analysis_json") and json_type("motion_studies"."motion_analysis_json") = 'object')),
	CONSTRAINT "motion_studies_beats_json_check" CHECK("motion_studies"."beats_json" is null or (json_valid("motion_studies"."beats_json") and json_type("motion_studies"."beats_json") = 'array')),
	CONSTRAINT "motion_studies_implementation_json_check" CHECK("motion_studies"."implementation_json" is null or (json_valid("motion_studies"."implementation_json") and json_type("motion_studies"."implementation_json") = 'array')),
	CONSTRAINT "motion_studies_verified_tech_check" CHECK(json_valid("motion_studies"."verified_tech_json") and json_type("motion_studies"."verified_tech_json") = 'array'),
	CONSTRAINT "motion_studies_protected_fields_check" CHECK(json_valid("motion_studies"."protected_fields") and json_type("motion_studies"."protected_fields") = 'array')
);
CREATE TABLE `motion_clips` (
	`id` text PRIMARY KEY NOT NULL,
	`motion_study_id` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`processing_status` text DEFAULT 'queued' NOT NULL,
	`processing_error` text,
	`source_format` text,
	`poster_ms` integer DEFAULT 1000 NOT NULL,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`fps` real,
	`bytes` integer,
	`evidence_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`motion_study_id`) REFERENCES `motion_studies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "motion_clips_status_check" CHECK("motion_clips"."processing_status" in ('queued', 'processing', 'ready', 'failed')),
	CONSTRAINT "motion_clips_label_check" CHECK(length(trim("motion_clips"."label")) between 1 and 60),
	CONSTRAINT "motion_clips_order_check" CHECK("motion_clips"."sort_order" >= 0),
	CONSTRAINT "motion_clips_poster_check" CHECK("motion_clips"."poster_ms" >= 0),
	CONSTRAINT "motion_clips_evidence_json_check" CHECK("motion_clips"."evidence_json" is null or (json_valid("motion_clips"."evidence_json") and json_type("motion_clips"."evidence_json") = 'object')),
	CONSTRAINT "motion_clips_ready_check" CHECK("motion_clips"."processing_status" <> 'ready' or ("motion_clips"."duration_ms" > 0 and "motion_clips"."width" > 0 and "motion_clips"."height" > 0 and "motion_clips"."evidence_json" is not null))
);
CREATE TABLE `motion_keyframes` (
	`id` text PRIMARY KEY NOT NULL,
	`motion_clip_id` text NOT NULL,
	`time_ms` integer NOT NULL,
	`reason` text NOT NULL,
	`image_path` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`motion_clip_id`) REFERENCES `motion_clips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "motion_keyframes_reason_check" CHECK("motion_keyframes"."reason" in ('start', 'onset', 'peak', 'settle', 'cut', 'fill', 'end')),
	CONSTRAINT "motion_keyframes_time_check" CHECK("motion_keyframes"."time_ms" >= 0),
	CONSTRAINT "motion_keyframes_order_check" CHECK("motion_keyframes"."sort_order" >= 0)
);
CREATE TABLE `motion_study_tags` (
	`motion_study_id` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`motion_study_id`, `type`, `normalized_value`),
	FOREIGN KEY (`motion_study_id`) REFERENCES `motion_studies`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "motion_study_tags_type_check" CHECK("motion_study_tags"."type" in ('trigger', 'technique', 'transition', 'easing', 'pacing', 'camera', 'interaction', 'type-motion', 'rendering')),
	CONSTRAINT "motion_study_tags_value_check" CHECK(length(trim("motion_study_tags"."value")) > 0 and length(trim("motion_study_tags"."normalized_value")) > 0),
	CONSTRAINT "motion_study_tags_order_check" CHECK("motion_study_tags"."sort_order" >= 0)
);
CREATE TABLE `app_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
