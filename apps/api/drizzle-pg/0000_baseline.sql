CREATE TABLE "app_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_references" (
	"collection_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "collection_references_collection_id_reference_id_pk" PRIMARY KEY("collection_id","reference_id"),
	CONSTRAINT "collection_references_sort_order_nonnegative" CHECK ("collection_references"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "collections_sort_order_nonnegative" CHECK ("collections"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_type_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"design_type_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "design_type_rules_kind_check" CHECK ("design_type_rules"."kind" in ('principle', 'avoid')),
	CONSTRAINT "design_type_rules_text_nonempty" CHECK (length(trim("design_type_rules"."text")) > 0),
	CONSTRAINT "design_type_rules_sort_order_nonnegative" CHECK ("design_type_rules"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_type_vocabulary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"design_type_id" uuid NOT NULL,
	"term" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "design_type_vocabulary_term_nonempty" CHECK (length(trim("design_type_vocabulary"."term")) > 0),
	CONSTRAINT "design_type_vocabulary_sort_order_nonnegative" CHECK ("design_type_vocabulary"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "design_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"deploy_for" text NOT NULL,
	"risk" text NOT NULL,
	"brief_block" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_types_sort_order_nonnegative" CHECK ("design_types"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "motion_clips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"motion_study_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"processing_status" text DEFAULT 'queued' NOT NULL,
	"processing_error" text,
	"source_format" text,
	"poster_ms" integer DEFAULT 1000 NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps" double precision,
	"bytes" bigint,
	"evidence_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "motion_clips_status_check" CHECK ("motion_clips"."processing_status" in ('queued', 'processing', 'ready', 'failed')),
	CONSTRAINT "motion_clips_label_check" CHECK (length(trim("motion_clips"."label")) between 1 and 60),
	CONSTRAINT "motion_clips_order_check" CHECK ("motion_clips"."sort_order" >= 0),
	CONSTRAINT "motion_clips_poster_check" CHECK ("motion_clips"."poster_ms" >= 0),
	CONSTRAINT "motion_clips_evidence_json_check" CHECK ("motion_clips"."evidence_json" is null or jsonb_typeof("motion_clips"."evidence_json") = 'object'),
	CONSTRAINT "motion_clips_ready_check" CHECK ("motion_clips"."processing_status" <> 'ready' or ("motion_clips"."duration_ms" > 0 and "motion_clips"."width" > 0 and "motion_clips"."height" > 0 and "motion_clips"."evidence_json" is not null))
);
--> statement-breakpoint
CREATE TABLE "motion_keyframes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"motion_clip_id" uuid NOT NULL,
	"time_ms" integer NOT NULL,
	"reason" text NOT NULL,
	"image_path" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "motion_keyframes_reason_check" CHECK ("motion_keyframes"."reason" in ('start', 'onset', 'peak', 'settle', 'cut', 'fill', 'end')),
	CONSTRAINT "motion_keyframes_time_check" CHECK ("motion_keyframes"."time_ms" >= 0),
	CONSTRAINT "motion_keyframes_order_check" CHECK ("motion_keyframes"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "motion_studies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference_id" uuid NOT NULL,
	"motion_status" text DEFAULT 'pending' NOT NULL,
	"motion_dna" text,
	"motion_thesis" text,
	"motion_brief" text,
	"motion_analysis_json" jsonb,
	"beats_json" jsonb,
	"implementation_json" jsonb,
	"inspection_notes" text,
	"verified_tech_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"protected_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "motion_studies_status_check" CHECK ("motion_studies"."motion_status" in ('pending', 'analyzed', 'manual', 'failed')),
	CONSTRAINT "motion_studies_analysis_json_check" CHECK ("motion_studies"."motion_analysis_json" is null or jsonb_typeof("motion_studies"."motion_analysis_json") = 'object'),
	CONSTRAINT "motion_studies_beats_json_check" CHECK ("motion_studies"."beats_json" is null or jsonb_typeof("motion_studies"."beats_json") = 'array'),
	CONSTRAINT "motion_studies_implementation_json_check" CHECK ("motion_studies"."implementation_json" is null or jsonb_typeof("motion_studies"."implementation_json") = 'array'),
	CONSTRAINT "motion_studies_verified_tech_check" CHECK (jsonb_typeof("motion_studies"."verified_tech_json") = 'array')
);
--> statement-breakpoint
CREATE TABLE "motion_study_tags" (
	"motion_study_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "motion_study_tags_motion_study_id_type_normalized_value_pk" PRIMARY KEY("motion_study_id","type","normalized_value"),
	CONSTRAINT "motion_study_tags_type_check" CHECK ("motion_study_tags"."type" in ('trigger', 'technique', 'transition', 'easing', 'pacing', 'camera', 'interaction', 'type-motion', 'rendering')),
	CONSTRAINT "motion_study_tags_value_check" CHECK (length(trim("motion_study_tags"."value")) > 0 and length(trim("motion_study_tags"."normalized_value")) > 0),
	CONSTRAINT "motion_study_tags_order_check" CHECK ("motion_study_tags"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reference_frames" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference_id" uuid NOT NULL,
	"frame_type" text NOT NULL,
	"image_path" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "reference_frames_type_check" CHECK ("reference_frames"."frame_type" in ('viewport', 'hero', 'scroll', 'fullpage')),
	CONSTRAINT "reference_frames_order_nonnegative" CHECK ("reference_frames"."sort_order" >= 0),
	CONSTRAINT "reference_frames_path_nonempty" CHECK (length(trim("reference_frames"."image_path")) > 0)
);
--> statement-breakpoint
CREATE TABLE "reference_tags" (
	"reference_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "reference_tags_reference_id_tag_id_pk" PRIMARY KEY("reference_id","tag_id"),
	CONSTRAINT "reference_tags_sort_order_nonnegative" CHECK ("reference_tags"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"original_path" text NOT NULL,
	"thumbnail_path" text NOT NULL,
	"design_type_id" uuid,
	"design_dna" text,
	"design_thesis" text,
	"design_brief" text,
	"image_recipe" text,
	"motion_brief" text,
	"asset_brief" text,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"analysis_json" jsonb,
	"protected_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"image_format" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "references_source_type_check" CHECK ("references"."source_type" in ('image', 'website')),
	CONSTRAINT "references_analysis_status_check" CHECK ("references"."analysis_status" in ('pending', 'analyzed', 'manual', 'failed')),
	CONSTRAINT "references_title_nonempty" CHECK (length(trim("references"."title")) > 0),
	CONSTRAINT "references_original_path_nonempty" CHECK (length(trim("references"."original_path")) > 0),
	CONSTRAINT "references_thumbnail_path_nonempty" CHECK (length(trim("references"."thumbnail_path")) > 0),
	CONSTRAINT "references_image_width_positive" CHECK ("references"."image_width" > 0),
	CONSTRAINT "references_image_height_positive" CHECK ("references"."image_height" > 0),
	CONSTRAINT "references_image_format_check" CHECK ("references"."image_format" in ('jpeg', 'png', 'webp')),
	CONSTRAINT "references_analysis_json_check" CHECK ("references"."analysis_json" is null or jsonb_typeof("references"."analysis_json") = 'object')
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	CONSTRAINT "tags_type_nonempty" CHECK (length(trim("tags"."type")) > 0),
	CONSTRAINT "tags_value_nonempty" CHECK (length(trim("tags"."value")) > 0),
	CONSTRAINT "tags_normalized_value_nonempty" CHECK (length(trim("tags"."normalized_value")) > 0)
);
--> statement-breakpoint
ALTER TABLE "collection_references" ADD CONSTRAINT "collection_references_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_references" ADD CONSTRAINT "collection_references_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_type_rules" ADD CONSTRAINT "design_type_rules_design_type_id_design_types_id_fk" FOREIGN KEY ("design_type_id") REFERENCES "public"."design_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_type_vocabulary" ADD CONSTRAINT "design_type_vocabulary_design_type_id_design_types_id_fk" FOREIGN KEY ("design_type_id") REFERENCES "public"."design_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_clips" ADD CONSTRAINT "motion_clips_motion_study_id_motion_studies_id_fk" FOREIGN KEY ("motion_study_id") REFERENCES "public"."motion_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_keyframes" ADD CONSTRAINT "motion_keyframes_motion_clip_id_motion_clips_id_fk" FOREIGN KEY ("motion_clip_id") REFERENCES "public"."motion_clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_studies" ADD CONSTRAINT "motion_studies_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_study_tags" ADD CONSTRAINT "motion_study_tags_motion_study_id_motion_studies_id_fk" FOREIGN KEY ("motion_study_id") REFERENCES "public"."motion_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_frames" ADD CONSTRAINT "reference_frames_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_tags" ADD CONSTRAINT "reference_tags_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_tags" ADD CONSTRAINT "reference_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_design_type_id_design_types_id_fk" FOREIGN KEY ("design_type_id") REFERENCES "public"."design_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_references_order_index" ON "collection_references" USING btree ("collection_id","sort_order");--> statement-breakpoint
CREATE INDEX "collection_references_reference_index" ON "collection_references" USING btree ("reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_unique" ON "collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "collections_sort_order_index" ON "collections" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "design_type_rules_design_type_index" ON "design_type_rules" USING btree ("design_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_type_rules_order_unique" ON "design_type_rules" USING btree ("design_type_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "design_type_vocabulary_design_type_index" ON "design_type_vocabulary" USING btree ("design_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_type_vocabulary_order_unique" ON "design_type_vocabulary" USING btree ("design_type_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "design_type_vocabulary_term_unique" ON "design_type_vocabulary" USING btree ("design_type_id","term");--> statement-breakpoint
CREATE UNIQUE INDEX "design_types_slug_unique" ON "design_types" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "design_types_sort_order_index" ON "design_types" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "motion_clips_order_unique" ON "motion_clips" USING btree ("motion_study_id","sort_order");--> statement-breakpoint
CREATE INDEX "motion_clips_status_index" ON "motion_clips" USING btree ("processing_status");--> statement-breakpoint
CREATE UNIQUE INDEX "motion_keyframes_order_unique" ON "motion_keyframes" USING btree ("motion_clip_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "motion_keyframes_path_unique" ON "motion_keyframes" USING btree ("image_path");--> statement-breakpoint
CREATE UNIQUE INDEX "motion_studies_reference_unique" ON "motion_studies" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "motion_studies_status_index" ON "motion_studies" USING btree ("motion_status");--> statement-breakpoint
CREATE UNIQUE INDEX "motion_study_tags_order_unique" ON "motion_study_tags" USING btree ("motion_study_id","sort_order");--> statement-breakpoint
CREATE INDEX "motion_study_tags_value_index" ON "motion_study_tags" USING btree ("type","normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_frames_order_unique" ON "reference_frames" USING btree ("reference_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_frames_path_unique" ON "reference_frames" USING btree ("image_path");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_tags_order_unique" ON "reference_tags" USING btree ("reference_id","sort_order");--> statement-breakpoint
CREATE INDEX "reference_tags_tag_index" ON "reference_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "references_design_type_index" ON "references" USING btree ("design_type_id");--> statement-breakpoint
CREATE INDEX "references_analysis_status_index" ON "references" USING btree ("analysis_status");--> statement-breakpoint
CREATE INDEX "references_created_at_index" ON "references" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_type_normalized_value_unique" ON "tags" USING btree ("type","normalized_value");