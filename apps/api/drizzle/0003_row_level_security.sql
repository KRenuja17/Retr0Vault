-- Row Level Security on every table, with no policies. Supabase exposes the
-- public schema through its Data API to the anon and authenticated roles;
-- without policies those roles can read and change nothing. The API connects
-- as the tables' owner, which RLS does not restrict.
ALTER TABLE "app_metadata" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_references" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "design_type_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "design_type_vocabulary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "design_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "motion_clips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "motion_keyframes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "motion_studies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "motion_study_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reference_frames" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reference_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "references" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reference_search" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "motion_search" ENABLE ROW LEVEL SECURITY;
