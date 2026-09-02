import type { DesignDirectionExportRequest, ReferenceExportRequest } from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import {
  renderAuthoredDirection, renderCategoryExport, renderCombinationManifest,
  renderReferenceExport, renderVocabularyExport, type ExportReference, type MarkdownFile,
} from "../export/markdown.js";
import { getDesignTypeById } from "./design-types.js";
import { getReference } from "./references.js";

function selectedReferences(connection: DatabaseConnection, ids: string[]): ExportReference[] {
  const types = new Map<string, ReturnType<typeof getDesignTypeById>>();
  return ids.map((id) => {
    const reference = getReference(connection, id);
    const typeId = reference.designTypeId;
    if (typeId !== null && !types.has(typeId)) types.set(typeId, getDesignTypeById(connection, typeId));
    return { reference, designType: typeId === null ? null : types.get(typeId)! };
  });
}

export function exportReferences(connection: DatabaseConnection, input: ReferenceExportRequest): MarkdownFile {
  // Read all selected records and relations from one snapshot. A missing ID
  // aborts the whole export instead of silently omitting a selected source.
  return connection.database.transaction(() => {
    switch (input.mode) {
      case "references": return renderReferenceExport(selectedReferences(connection, input.referenceIds));
      case "category-brief": return renderCategoryExport(input.designTypeIds.map((id) => getDesignTypeById(connection, id)));
      case "vocabulary": return renderVocabularyExport(selectedReferences(connection, input.referenceIds),
        input.designTypeIds.map((id) => getDesignTypeById(connection, id)));
    }
  });
}

export function exportDesignDirection(connection: DatabaseConnection, input: DesignDirectionExportRequest): MarkdownFile {
  return connection.database.transaction(() => {
    const references = selectedReferences(connection, input.referenceIds);
    return input.mode === "authored"
      ? renderAuthoredDirection(references, input.direction)
      : renderCombinationManifest(references, input.intent);
  });
}
