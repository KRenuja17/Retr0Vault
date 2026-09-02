ALTER TABLE `references` ADD `protected_fields` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE `references`
SET `protected_fields` = '["title","designTypeId","designDNA","designThesis","designBrief","imageRecipe","motionBrief","assetBrief","analysisJson","tags"]'
WHERE `analysis_status` = 'manual';
