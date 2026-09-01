CREATE TABLE `collection_references` (
	`collection_id` text NOT NULL,
	`reference_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `reference_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "collection_references_sort_order_nonnegative" CHECK("collection_references"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `collection_references_order_index` ON `collection_references` (`collection_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `collection_references_reference_index` ON `collection_references` (`reference_id`);--> statement-breakpoint
CREATE TABLE `reference_tags` (
	`reference_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`reference_id`, `tag_id`),
	FOREIGN KEY (`reference_id`) REFERENCES `references`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reference_tags_sort_order_nonnegative" CHECK("reference_tags"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reference_tags_order_unique` ON `reference_tags` (`reference_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `reference_tags_tag_index` ON `reference_tags` (`tag_id`);--> statement-breakpoint
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
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
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
--> statement-breakpoint
CREATE INDEX `references_design_type_index` ON `references` (`design_type_id`);--> statement-breakpoint
CREATE INDEX `references_analysis_status_index` ON `references` (`analysis_status`);--> statement-breakpoint
CREATE INDEX `references_created_at_index` ON `references` (`created_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	CONSTRAINT "tags_type_nonempty" CHECK(length(trim("tags"."type")) > 0),
	CONSTRAINT "tags_value_nonempty" CHECK(length(trim("tags"."value")) > 0),
	CONSTRAINT "tags_normalized_value_nonempty" CHECK(length(trim("tags"."normalized_value")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_type_normalized_value_unique` ON `tags` (`type`,`normalized_value`);