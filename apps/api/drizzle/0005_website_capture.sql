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
--> statement-breakpoint
CREATE UNIQUE INDEX `reference_frames_order_unique` ON `reference_frames` (`reference_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `reference_frames_path_unique` ON `reference_frames` (`image_path`);
