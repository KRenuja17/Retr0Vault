import { statsResponseSchema, type StatsResponse } from "@retr0vault/shared";
import type { DatabaseConnection } from "../database/connection.js";

export function getStats(connection: DatabaseConnection): StatsResponse {
  // A single read snapshot prevents mixed counts during CLI imports in WAL mode.
  return connection.sqlite.transaction(() => {
    const totals = connection.sqlite.prepare(`
      SELECT count(*) AS totalReferences,
        count(CASE WHEN analysis_status = 'pending' THEN 1 END) AS pendingReferences,
        count(CASE WHEN analysis_status = 'analyzed' THEN 1 END) AS analyzedReferences,
        count(CASE WHEN design_type_id IS NULL THEN 1 END) AS unassignedReferences
      FROM "references"
    `).get() as Record<string, number>;
    const countsByDesignType = connection.sqlite.prepare(`
      SELECT d.id, d.name, d.slug, count(r.id) AS referenceCount
      FROM design_types d LEFT JOIN "references" r ON r.design_type_id = d.id
      GROUP BY d.id ORDER BY d.sort_order, d.id
    `).all();
    const countsByCollection = connection.sqlite.prepare(`
      SELECT c.id, c.name, c.slug, count(cr.reference_id) AS referenceCount
      FROM collections c LEFT JOIN collection_references cr ON cr.collection_id = c.id
      GROUP BY c.id ORDER BY c.sort_order, c.id
    `).all();
    return statsResponseSchema.parse({ ...totals, countsByDesignType, countsByCollection });
  })();
}
