-- Additive guards preserve reference rowids, foreign keys, and FTS triggers.
-- Invalid legacy JSON fails the migration transaction without changing user data.
CREATE TEMP TABLE reference_json_preflight (invalid_count INTEGER CHECK (invalid_count = 0));
--> statement-breakpoint
INSERT INTO reference_json_preflight SELECT count(*) FROM "references" WHERE CASE WHEN analysis_json IS NULL THEN 0
    WHEN json_valid(analysis_json) = 0 THEN 1
    ELSE json_type(analysis_json) <> 'object' END
  OR CASE WHEN json_valid(protected_fields) = 0 THEN 1
    WHEN json_type(protected_fields) <> 'array' THEN 1
    ELSE json_array_length(protected_fields) > 10
      OR EXISTS (SELECT 1 FROM json_each(protected_fields)
        WHERE type <> 'text' OR value NOT IN ('title','designTypeId','designDNA','designThesis','designBrief','imageRecipe','motionBrief','assetBrief','analysisJson','tags'))
      OR (SELECT count(*) FROM json_each(protected_fields)) <>
         (SELECT count(DISTINCT value) FROM json_each(protected_fields))
    END;
--> statement-breakpoint
DROP TABLE reference_json_preflight;
--> statement-breakpoint
CREATE TRIGGER references_json_insert_guard BEFORE INSERT ON "references"
WHEN CASE WHEN NEW.analysis_json IS NULL THEN 0
    WHEN json_valid(NEW.analysis_json) = 0 THEN 1
    ELSE json_type(NEW.analysis_json) <> 'object' END
  OR CASE WHEN json_valid(NEW.protected_fields) = 0 THEN 1
    WHEN json_type(NEW.protected_fields) <> 'array' THEN 1
    ELSE json_array_length(NEW.protected_fields) > 10
      OR EXISTS (SELECT 1 FROM json_each(NEW.protected_fields)
        WHERE type <> 'text' OR value NOT IN ('title','designTypeId','designDNA','designThesis','designBrief','imageRecipe','motionBrief','assetBrief','analysisJson','tags'))
      OR (SELECT count(*) FROM json_each(NEW.protected_fields)) <>
         (SELECT count(DISTINCT value) FROM json_each(NEW.protected_fields))
    END
BEGIN SELECT RAISE(ABORT, 'Invalid reference analysis or protected fields JSON'); END;
--> statement-breakpoint
CREATE TRIGGER references_json_update_guard BEFORE UPDATE OF analysis_json, protected_fields ON "references"
WHEN CASE WHEN NEW.analysis_json IS NULL THEN 0
    WHEN json_valid(NEW.analysis_json) = 0 THEN 1
    ELSE json_type(NEW.analysis_json) <> 'object' END
  OR CASE WHEN json_valid(NEW.protected_fields) = 0 THEN 1
    WHEN json_type(NEW.protected_fields) <> 'array' THEN 1
    ELSE json_array_length(NEW.protected_fields) > 10
      OR EXISTS (SELECT 1 FROM json_each(NEW.protected_fields)
        WHERE type <> 'text' OR value NOT IN ('title','designTypeId','designDNA','designThesis','designBrief','imageRecipe','motionBrief','assetBrief','analysisJson','tags'))
      OR (SELECT count(*) FROM json_each(NEW.protected_fields)) <>
         (SELECT count(DISTINCT value) FROM json_each(NEW.protected_fields))
    END
BEGIN SELECT RAISE(ABORT, 'Invalid reference analysis or protected fields JSON'); END;
