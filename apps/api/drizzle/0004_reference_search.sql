-- FTS5 and its triggers are maintained here because Drizzle does not model
-- virtual tables. UUIDs remain the reference identity, not SQLite rowids.
CREATE VIRTUAL TABLE reference_search USING fts5(
  reference_id UNINDEXED,
  title,
  design_dna,
  design_thesis,
  tags,
  vocabulary,
  design_type,
  source_url,
  design_brief,
  image_recipe,
  analysis_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
-- A single projection defines both initial backfill and every refresh. Its
-- column order must match the FTS table and the query's BM25 weights.
CREATE VIEW reference_search_source AS
SELECT r.id AS reference_id,
  r.title,
  coalesce(r.design_dna, '') AS design_dna,
  coalesce(r.design_thesis, '') AS design_thesis,
  coalesce((SELECT group_concat(t.normalized_value, ' ')
    FROM reference_tags rt JOIN tags t ON t.id = rt.tag_id
    WHERE rt.reference_id = r.id), '') AS tags,
  coalesce((SELECT group_concat(v.term, ' ')
    FROM design_type_vocabulary v WHERE v.design_type_id = r.design_type_id), '') AS vocabulary,
  coalesce(d.name || ' ' || d.slug || ' ' || d.description, '') AS design_type,
  coalesce(r.source_url, '') AS source_url,
  coalesce(r.design_brief, '') AS design_brief,
  coalesce(r.image_recipe, '') AS image_recipe,
  coalesce((SELECT group_concat(j.atom, ' ')
    FROM json_tree(CASE WHEN json_valid(r.analysis_json) THEN r.analysis_json ELSE '{}' END) j
    WHERE j.type = 'text'), '') AS analysis_text
FROM "references" r LEFT JOIN design_types d ON d.id = r.design_type_id;
--> statement-breakpoint
INSERT INTO reference_search SELECT * FROM reference_search_source;
--> statement-breakpoint
CREATE TRIGGER references_search_insert AFTER INSERT ON "references" BEGIN
  INSERT INTO reference_search SELECT * FROM reference_search_source WHERE reference_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER references_search_update AFTER UPDATE OF
  id, title, design_dna, design_thesis, design_type_id, source_url,
  design_brief, image_recipe, analysis_json ON "references" BEGIN
  DELETE FROM reference_search WHERE reference_id = old.id;
  INSERT INTO reference_search SELECT * FROM reference_search_source WHERE reference_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER references_search_delete AFTER DELETE ON "references" BEGIN
  DELETE FROM reference_search WHERE reference_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER reference_tags_search_insert AFTER INSERT ON reference_tags BEGIN
  DELETE FROM reference_search WHERE reference_id = new.reference_id;
  INSERT INTO reference_search SELECT * FROM reference_search_source WHERE reference_id = new.reference_id;
END;
--> statement-breakpoint
CREATE TRIGGER reference_tags_search_update AFTER UPDATE OF reference_id, tag_id ON reference_tags BEGIN
  DELETE FROM reference_search WHERE reference_id IN (old.reference_id, new.reference_id);
  INSERT INTO reference_search SELECT * FROM reference_search_source WHERE reference_id IN (old.reference_id, new.reference_id);
END;
--> statement-breakpoint
CREATE TRIGGER reference_tags_search_delete AFTER DELETE ON reference_tags BEGIN
  DELETE FROM reference_search WHERE reference_id = old.reference_id;
  INSERT INTO reference_search SELECT * FROM reference_search_source WHERE reference_id = old.reference_id;
END;
--> statement-breakpoint
CREATE TRIGGER tags_search_update AFTER UPDATE OF value, normalized_value ON tags BEGIN
  DELETE FROM reference_search WHERE reference_id IN (SELECT reference_id FROM reference_tags WHERE tag_id = new.id);
  INSERT INTO reference_search SELECT * FROM reference_search_source
    WHERE reference_id IN (SELECT reference_id FROM reference_tags WHERE tag_id = new.id);
END;
--> statement-breakpoint
CREATE TRIGGER design_types_search_update AFTER UPDATE OF name, slug, description ON design_types BEGIN
  DELETE FROM reference_search WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id = new.id);
  INSERT INTO reference_search SELECT * FROM reference_search_source
    WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id = new.id);
END;
--> statement-breakpoint
CREATE TRIGGER vocabulary_search_insert AFTER INSERT ON design_type_vocabulary BEGIN
  DELETE FROM reference_search WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id = new.design_type_id);
  INSERT INTO reference_search SELECT * FROM reference_search_source
    WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id = new.design_type_id);
END;
--> statement-breakpoint
CREATE TRIGGER vocabulary_search_update AFTER UPDATE OF term, design_type_id ON design_type_vocabulary BEGIN
  DELETE FROM reference_search WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id IN (old.design_type_id, new.design_type_id));
  INSERT INTO reference_search SELECT * FROM reference_search_source
    WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id IN (old.design_type_id, new.design_type_id));
END;
--> statement-breakpoint
CREATE TRIGGER vocabulary_search_delete AFTER DELETE ON design_type_vocabulary BEGIN
  DELETE FROM reference_search WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id = old.design_type_id);
  INSERT INTO reference_search SELECT * FROM reference_search_source
    WHERE reference_id IN (SELECT id FROM "references" WHERE design_type_id = old.design_type_id);
END;
