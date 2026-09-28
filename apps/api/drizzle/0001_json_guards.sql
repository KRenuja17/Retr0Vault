-- Protected-field lists are JSON arrays of distinct names from a fixed set.
-- SQLite needed triggers to say so (its migration 0006); Postgres can check it
-- in a CHECK constraint through one immutable helper.
CREATE FUNCTION rv_valid_name_set(value jsonb, allowed text[], max_items integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= max_items
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'string' OR NOT ((item #>> '{}') = ANY (allowed))
    )
    AND (SELECT count(DISTINCT item) FROM jsonb_array_elements(value) AS item) = jsonb_array_length(value)
$$;
--> statement-breakpoint
ALTER TABLE "references" ADD CONSTRAINT "references_protected_fields_check" CHECK (
  rv_valid_name_set(
    "protected_fields",
    ARRAY['title', 'designTypeId', 'designDNA', 'designThesis', 'designBrief', 'imageRecipe', 'motionBrief', 'assetBrief', 'analysisJson', 'tags'],
    10
  )
);
--> statement-breakpoint
ALTER TABLE "motion_studies" ADD CONSTRAINT "motion_studies_protected_fields_check" CHECK (
  rv_valid_name_set(
    "protected_fields",
    ARRAY['motionDNA', 'motionThesis', 'motionBrief', 'analysis', 'beats', 'implementation', 'techniques'],
    7
  )
);
