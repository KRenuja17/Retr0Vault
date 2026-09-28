import type { DesignDirectionExportRequest, ReferenceExportRequest } from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
import {
  renderAuthoredDirection, renderCategoryExport, renderCombinationManifest,
  renderReferenceExport, renderVocabularyExport, type ExportReference, type MarkdownFile,
} from "../export/markdown.js";
import { getDesignTypeById } from "./design-types.js";
import { getMotionStudy } from "./motion.js";
import { assertOwnedReferences, type Owner } from "./ownership.js";
import { getReference } from "./references.js";

async function selectedReferences(db: Db, ids: string[], owner: Owner): Promise<ExportReference[]> {
  // Another account's reference is as missing as an unknown one.
  await assertOwnedReferences(db, ids, owner);
  const types = new Map<string, Awaited<ReturnType<typeof getDesignTypeById>>>();
  const selected: ExportReference[] = [];
  for (const id of ids) {
    const reference = await getReference(db, id);
    const typeId = reference.designTypeId;
    if (typeId !== null && !types.has(typeId)) types.set(typeId, await getDesignTypeById(db, typeId, owner));
    selected.push({
      reference,
      designType: typeId === null ? null : types.get(typeId)!,
      motion: reference.motion === null ? null : await getMotionStudy(db, id),
    });
  }
  return selected;
}

async function designTypesById(db: Db, ids: string[], owner: Owner) {
  const loaded = [];
  for (const id of ids) loaded.push(await getDesignTypeById(db, id, owner));
  return loaded;
}

const snapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;

export function exportReferences(db: Db, input: ReferenceExportRequest, owner?: Owner): Promise<MarkdownFile> {
  // Read all selected records and relations from one snapshot. A missing ID
  // aborts the whole export instead of silently omitting a selected source.
  return db.transaction(async (transaction) => {
    switch (input.mode) {
      case "references": return renderReferenceExport(await selectedReferences(transaction, input.referenceIds, owner));
      case "category-brief": return renderCategoryExport(await designTypesById(transaction, input.designTypeIds, owner));
      case "vocabulary": return renderVocabularyExport(await selectedReferences(transaction, input.referenceIds, owner),
        await designTypesById(transaction, input.designTypeIds, owner));
    }
  }, snapshot);
}

export function exportDesignDirection(db: Db, input: DesignDirectionExportRequest, owner?: Owner): Promise<MarkdownFile> {
  return db.transaction(async (transaction) => {
    const references = await selectedReferences(transaction, input.referenceIds, owner);
    return input.mode === "authored"
      ? renderAuthoredDirection(references, input.direction)
      : renderCombinationManifest(references, input.intent);
  }, snapshot);
}
