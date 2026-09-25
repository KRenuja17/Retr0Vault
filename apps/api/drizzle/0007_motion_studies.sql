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
--> statement-breakpoint
CREATE UNIQUE INDEX `motion_clips_order_unique` ON `motion_clips` (`motion_study_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `motion_clips_status_index` ON `motion_clips` (`processing_status`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `motion_keyframes_order_unique` ON `motion_keyframes` (`motion_clip_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `motion_keyframes_path_unique` ON `motion_keyframes` (`image_path`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `motion_studies_reference_unique` ON `motion_studies` (`reference_id`);--> statement-breakpoint
CREATE INDEX `motion_studies_status_index` ON `motion_studies` (`motion_status`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `motion_study_tags_order_unique` ON `motion_study_tags` (`motion_study_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `motion_study_tags_value_index` ON `motion_study_tags` (`type`,`normalized_value`);