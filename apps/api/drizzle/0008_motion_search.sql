-- Motion-study search. Kept apart from reference_search (0004) so motion text
-- never requires rebuilding the reference triggers. Study UUIDs, not rowids,
-- identify documents; column order must match motionSearchRank's BM25 weights.
CREATE VIRTUAL TABLE motion_search USING fts5(
  motion_study_id UNINDEXED,
  title,
  motion_dna,
  techniques,
  beats,
  motion_thesis,
  motion_brief,
  notes,
  analysis_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE VIEW motion_search_source AS
SELECT s.id AS motion_study_id,
  r.title,
  coalesce(s.motion_dna, '') AS motion_dna,
  coalesce((SELECT group_concat(t.type || ' ' || t.normalized_value, ' ')
    FROM motion_study_tags t WHERE t.motion_study_id = s.id), '') AS techniques,
  coalesce((SELECT group_concat(coalesce(json_extract(b.value, '$.trigger'), '') || ' ' ||
      coalesce(json_extract(b.value, '$.label'), '') || ' ' || coalesce(json_extract(b.value, '$.description'), ''), ' ')
    FROM json_each(CASE WHEN json_valid(s.beats_json) THEN s.beats_json ELSE '[]' END) b), '') AS beats,
  coalesce(s.motion_thesis, '') AS motion_thesis,
  coalesce(s.motion_brief, '') AS motion_brief,
  coalesce(s.inspection_notes, '') || ' ' || coalesce((SELECT group_concat(coalesce(json_extract(v.value, '$.claim'), ''), ' ')
    FROM json_each(CASE WHEN json_valid(s.verified_tech_json) THEN s.verified_tech_json ELSE '[]' END) v), '') AS notes,
  coalesce((SELECT group_concat(j.atom, ' ')
    FROM json_tree(CASE WHEN json_valid(s.motion_analysis_json) THEN s.motion_analysis_json ELSE '{}' END) j
    WHERE j.type = 'text'), '') || ' ' || coalesce((SELECT group_concat(coalesce(json_extract(i.value, '$.claim'), ''), ' ')
    FROM json_each(CASE WHEN json_valid(s.implementation_json) THEN s.implementation_json ELSE '[]' END) i), '') AS analysis_text
FROM motion_studies s JOIN "references" r ON r.id = s.reference_id;
--> statement-breakpoint
INSERT INTO motion_search SELECT * FROM motion_search_source;
--> statement-breakpoint
CREATE TRIGGER motion_studies_search_insert AFTER INSERT ON motion_studies BEGIN
  INSERT INTO motion_search SELECT * FROM motion_search_source WHERE motion_study_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER motion_studies_search_update AFTER UPDATE OF
  id, reference_id, motion_dna, motion_thesis, motion_brief, motion_analysis_json, beats_json,
  implementation_json, inspection_notes, verified_tech_json ON motion_studies BEGIN
  DELETE FROM motion_search WHERE motion_study_id = old.id;
  INSERT INTO motion_search SELECT * FROM motion_search_source WHERE motion_study_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER motion_studies_search_delete AFTER DELETE ON motion_studies BEGIN
  DELETE FROM motion_search WHERE motion_study_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER motion_study_tags_search_insert AFTER INSERT ON motion_study_tags BEGIN
  DELETE FROM motion_search WHERE motion_study_id = new.motion_study_id;
  INSERT INTO motion_search SELECT * FROM motion_search_source WHERE motion_study_id = new.motion_study_id;
END;
--> statement-breakpoint
CREATE TRIGGER motion_study_tags_search_update AFTER UPDATE ON motion_study_tags BEGIN
  DELETE FROM motion_search WHERE motion_study_id IN (old.motion_study_id, new.motion_study_id);
  INSERT INTO motion_search SELECT * FROM motion_search_source WHERE motion_study_id IN (old.motion_study_id, new.motion_study_id);
END;
--> statement-breakpoint
CREATE TRIGGER motion_study_tags_search_delete AFTER DELETE ON motion_study_tags BEGIN
  DELETE FROM motion_search WHERE motion_study_id = old.motion_study_id;
  INSERT INTO motion_search SELECT * FROM motion_search_source WHERE motion_study_id = old.motion_study_id;
END;
--> statement-breakpoint
-- A reference rename must show up in motion search too. Additive: 0004's own
-- reference triggers are untouched.
CREATE TRIGGER references_motion_search_title AFTER UPDATE OF title ON "references"
WHEN EXISTS (SELECT 1 FROM motion_studies WHERE reference_id = new.id) BEGIN
  DELETE FROM motion_search WHERE motion_study_id IN (SELECT id FROM motion_studies WHERE reference_id = new.id);
  INSERT INTO motion_search SELECT * FROM motion_search_source
    WHERE motion_study_id IN (SELECT id FROM motion_studies WHERE reference_id = new.id);
END;
