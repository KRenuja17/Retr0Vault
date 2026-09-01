CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "collections_sort_order_nonnegative" CHECK("collections"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE INDEX `collections_sort_order_index` ON `collections` (`sort_order`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `design_type_rules_design_type_index` ON `design_type_rules` (`design_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `design_type_rules_order_unique` ON `design_type_rules` (`design_type_id`,`kind`,`sort_order`);--> statement-breakpoint
CREATE TABLE `design_type_vocabulary` (
	`id` text PRIMARY KEY NOT NULL,
	`design_type_id` text NOT NULL,
	`term` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`design_type_id`) REFERENCES `design_types`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "design_type_vocabulary_term_nonempty" CHECK(length(trim("design_type_vocabulary"."term")) > 0),
	CONSTRAINT "design_type_vocabulary_sort_order_nonnegative" CHECK("design_type_vocabulary"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE INDEX `design_type_vocabulary_design_type_index` ON `design_type_vocabulary` (`design_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `design_type_vocabulary_order_unique` ON `design_type_vocabulary` (`design_type_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `design_type_vocabulary_term_unique` ON `design_type_vocabulary` (`design_type_id`,`term`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `design_types_slug_unique` ON `design_types` (`slug`);--> statement-breakpoint
CREATE INDEX `design_types_sort_order_index` ON `design_types` (`sort_order`);