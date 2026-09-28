-- Full-text search for references and motion studies (Phase C port of SQLite's
-- FTS5 tables from 0004 and 0008).
--
-- Each reference and each motion study has one weighted tsvector, rebuilt by
-- triggers whenever a source field, tag, design type or vocabulary term
-- changes. Text is folded the same way on both sides: accents (the combining
-- marks U+0300–U+036F after NFKD) are removed, case is lowered, and anything
-- that is not a letter or digit separates words. The 'simple' configuration
-- adds no stemming and no stop words, matching FTS5's unicode61 tokenizer.
--
-- Weights stand in for the FTS5 BM25 column weights:
--   references: A title | B design DNA, tags, design type | C thesis, vocabulary
--               | D source URL, brief, recipe, analysis text
--   motion:     A motion DNA, title | B techniques, beats | C thesis, brief, notes
--               | D analysis text and implementation claims
CREATE FUNCTION rv_search_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(
    lower(regexp_replace(normalize(coalesce(value, ''), NFKD), '[̀-ͯ]', '', 'g')),
    '[^[:alnum:]]+', ' ', 'g')
$$;
--> statement-breakpoint
-- The string values of a JSON document, never its keys.
CREATE FUNCTION rv_json_text(value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(string_agg(item #>> '{}', ' '), '')
  FROM jsonb_path_query(coalesce(value, '{}'::jsonb), 'strict $.** ? (@.type() == "string")') AS item
$$;
--> statement-breakpoint
CREATE FUNCTION rv_document(value text, weight "char")
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT setweight(to_tsvector('simple', rv_search_text(value)), weight)
$$;
--> statement-breakpoint
CREATE TABLE "reference_search" (
  "reference_id" uuid PRIMARY KEY REFERENCES "references"("id") ON DELETE CASCADE,
  "document" tsvector NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reference_search_document_index" ON "reference_search" USING gin ("document");
--> statement-breakpoint
CREATE FUNCTION rv_refresh_reference_search(target uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM reference_search WHERE reference_id = target;
  INSERT INTO reference_search (reference_id, document)
  SELECT r.id,
    rv_document(r.title, 'A')
    || rv_document(concat_ws(' ', r.design_dna,
         (SELECT string_agg(t.normalized_value, ' ') FROM reference_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.reference_id = r.id),
         d.name, d.slug, d.description), 'B')
    || rv_document(concat_ws(' ', r.design_thesis,
         (SELECT string_agg(v.term, ' ') FROM design_type_vocabulary v WHERE v.design_type_id = r.design_type_id)), 'C')
    || rv_document(concat_ws(' ', r.source_url, r.design_brief, r.image_recipe, rv_json_text(r.analysis_json)), 'D')
  FROM "references" r
  LEFT JOIN design_types d ON d.id = r.design_type_id
  WHERE r.id = target;
END
$$;
--> statement-breakpoint
CREATE FUNCTION rv_references_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM rv_refresh_reference_search(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "references_search_refresh"
AFTER INSERT OR UPDATE OF title, design_dna, design_thesis, design_type_id, source_url, design_brief, image_recipe, analysis_json
ON "references" FOR EACH ROW EXECUTE FUNCTION rv_references_search_trigger();
--> statement-breakpoint
CREATE FUNCTION rv_reference_tags_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM rv_refresh_reference_search(OLD.reference_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.reference_id <> OLD.reference_id OR NEW.tag_id <> OLD.tag_id) THEN
    PERFORM rv_refresh_reference_search(NEW.reference_id);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "reference_tags_search_refresh"
AFTER INSERT OR UPDATE OR DELETE ON "reference_tags" FOR EACH ROW EXECUTE FUNCTION rv_reference_tags_search_trigger();
--> statement-breakpoint
CREATE FUNCTION rv_tags_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM rv_refresh_reference_search(rt.reference_id) FROM reference_tags rt WHERE rt.tag_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "tags_search_refresh"
AFTER UPDATE OF value, normalized_value ON "tags" FOR EACH ROW EXECUTE FUNCTION rv_tags_search_trigger();
--> statement-breakpoint
CREATE FUNCTION rv_design_types_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM rv_refresh_reference_search(r.id) FROM "references" r WHERE r.design_type_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "design_types_search_refresh"
AFTER UPDATE OF name, slug, description ON "design_types" FOR EACH ROW EXECUTE FUNCTION rv_design_types_search_trigger();
--> statement-breakpoint
CREATE FUNCTION rv_vocabulary_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM rv_refresh_reference_search(r.id) FROM "references" r WHERE r.design_type_id = OLD.design_type_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM rv_refresh_reference_search(r.id) FROM "references" r WHERE r.design_type_id = NEW.design_type_id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "design_type_vocabulary_search_refresh"
AFTER INSERT OR UPDATE OR DELETE ON "design_type_vocabulary" FOR EACH ROW EXECUTE FUNCTION rv_vocabulary_search_trigger();
--> statement-breakpoint
CREATE TABLE "motion_search" (
  "motion_study_id" uuid PRIMARY KEY REFERENCES "motion_studies"("id") ON DELETE CASCADE,
  "document" tsvector NOT NULL
);
--> statement-breakpoint
CREATE INDEX "motion_search_document_index" ON "motion_search" USING gin ("document");
--> statement-breakpoint
CREATE FUNCTION rv_refresh_motion_search(target uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM motion_search WHERE motion_study_id = target;
  INSERT INTO motion_search (motion_study_id, document)
  SELECT s.id,
    rv_document(concat_ws(' ', s.motion_dna, r.title), 'A')
    || rv_document(concat_ws(' ',
         (SELECT string_agg(t.type || ' ' || t.normalized_value, ' ') FROM motion_study_tags t WHERE t.motion_study_id = s.id),
         (SELECT string_agg(concat_ws(' ', b ->> 'trigger', b ->> 'label', b ->> 'description'), ' ')
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.beats_json) = 'array' THEN s.beats_json ELSE '[]'::jsonb END) AS b)), 'B')
    || rv_document(concat_ws(' ', s.motion_thesis, s.motion_brief, s.inspection_notes,
         (SELECT string_agg(v ->> 'claim', ' ')
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.verified_tech_json) = 'array' THEN s.verified_tech_json ELSE '[]'::jsonb END) AS v)), 'C')
    || rv_document(concat_ws(' ', rv_json_text(s.motion_analysis_json),
         (SELECT string_agg(i ->> 'claim', ' ')
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.implementation_json) = 'array' THEN s.implementation_json ELSE '[]'::jsonb END) AS i)), 'D')
  FROM motion_studies s
  JOIN "references" r ON r.id = s.reference_id
  WHERE s.id = target;
END
$$;
--> statement-breakpoint
CREATE FUNCTION rv_motion_studies_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM rv_refresh_motion_search(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "motion_studies_search_refresh"
AFTER INSERT OR UPDATE OF motion_dna, motion_thesis, motion_brief, motion_analysis_json, beats_json, implementation_json, inspection_notes, verified_tech_json
ON "motion_studies" FOR EACH ROW EXECUTE FUNCTION rv_motion_studies_search_trigger();
--> statement-breakpoint
CREATE FUNCTION rv_motion_tags_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM rv_refresh_motion_search(OLD.motion_study_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN PERFORM rv_refresh_motion_search(NEW.motion_study_id); END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "motion_study_tags_search_refresh"
AFTER INSERT OR UPDATE OR DELETE ON "motion_study_tags" FOR EACH ROW EXECUTE FUNCTION rv_motion_tags_search_trigger();
--> statement-breakpoint
CREATE FUNCTION rv_reference_title_motion_search_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM rv_refresh_motion_search(s.id) FROM motion_studies s WHERE s.reference_id = NEW.id;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "references_title_motion_search_refresh"
AFTER UPDATE OF title ON "references" FOR EACH ROW EXECUTE FUNCTION rv_reference_title_motion_search_trigger();
--> statement-breakpoint
-- Index whatever the database already holds.
SELECT rv_refresh_reference_search(id) FROM "references";
--> statement-breakpoint
SELECT rv_refresh_motion_search(id) FROM motion_studies;
