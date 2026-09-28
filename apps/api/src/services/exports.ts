import type { DesignDirectionExportRequest, ReferenceExportRequest } from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
import {
  renderAuthoredDirection, renderCategoryExport, renderCombinationManifest,
  renderReferenceExport, renderVocabularyExport, type ExportReference, type MarkdownFile,
} from "../export/markdown.js";
import { getDesignTypeById } from "./design-types.js";
import { getMotionStudy } from "./motion.js";
import { getReference } from "./references.js";

async function selectedReferences(db: Db, ids: string[]): Promise<ExportReference[]> {
  const types = new Map<string, Awaited<ReturnType<typeof getDesignTypeById>>>();
  const selected: ExportReference[] = [];
  for (const id of ids) {
    const reference = await getReference(db, id);
    const typeId = reference.designTypeId;
    if (typeId !== null && !types.has(typeId)) types.set(typeId, await getDesignTypeById(db, typeId));
    selected.push({
      reference,
      designType: typeId === null ? null : types.get(typeId)!,
      motion: reference.motion === null ? null : await getMotionStudy(db, id),
    });
  }
  return selected;
}

async function designTypesById(db: Db, ids: string[]) {
  const loaded = [];
  for (const id of ids) loaded.push(await getDesignTypeById(db, id));
  return loaded;
}

const snapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

export function exportReferences(db: Db, input: ReferenceExportRequest): Promise<MarkdownFile> {
  // Read all selected records and relations from one snapshot. A missing ID
  // aborts the whole export instead of silently omitting a selected source.
  return db.transaction(async (transaction) => {
    switch (input.mode) {
      case "references": return renderReferenceExport(await selectedReferences(transaction, input.referenceIds));
      case "category-brief": return renderCategoryExport(await designTypesById(transaction, input.designTypeIds));
      case "vocabulary": return renderVocabularyExport(await selectedReferences(transaction, input.referenceIds),
        await designTypesById(transaction, input.designTypeIds));
    }
  }, snapshot);
}

export function exportDesignDirection(db: Db, input: DesignDirectionExportRequest): Promise<MarkdownFile> {
  return db.transaction(async (transaction) => {
    const references = await selectedReferences(transaction, input.referenceIds);
    return input.mode === "authored"
      ? renderAuthoredDirection(references, input.direction)
      : renderCombinationManifest(references, input.intent);
  }, snapshot);
}
