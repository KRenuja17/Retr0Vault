import { sql } from "drizzle-orm";

import { statsResponseSchema, type StatsResponse } from "@retr0vault/shared";

import { rowsOf, type Db } from "../database/connection.js";
import { motionTriggerCounts } from "./motion.js";

export function getStats(db: Db): Promise<StatsResponse> {
  // A single read snapshot prevents mixed counts while an import is writing.
  return db.transaction(async (transaction) => {
    const [totals] = rowsOf<Record<string, number>>(await transaction.execute(sql`
      select count(*)::integer as "totalReferences",
        count(*) filter (where analysis_status = 'pending')::integer as "pendingReferences",
        count(*) filter (where analysis_status = 'analyzed')::integer as "analyzedReferences",
        count(*) filter (where design_type_id is null)::integer as "unassignedReferences"
      from "references"
    `));
    const countsByDesignType = rowsOf(await transaction.execute(sql`
      select d.id, d.name, d.slug, count(r.id)::integer as "referenceCount"
      from design_types d left join "references" r on r.design_type_id = d.id
      group by d.id order by d.sort_order, d.id
    `));
    const countsByCollection = rowsOf(await transaction.execute(sql`
      select c.id, c.name, c.slug, count(cr.reference_id)::integer as "referenceCount"
      from collections c left join collection_references cr on cr.collection_id = c.id
      group by c.id order by c.sort_order, c.id
    `));
    const [motionStudies] = rowsOf<Record<string, number>>(await transaction.execute(sql`
      select count(*)::integer as total,
        count(*) filter (where motion_status = 'pending')::integer as pending,
        count(*) filter (where motion_status = 'analyzed')::integer as analyzed,
        count(*) filter (where motion_status = 'manual')::integer as manual,
        count(*) filter (where motion_status = 'failed')::integer as failed
      from motion_studies
    `));
    return statsResponseSchema.parse({
      ...totals, countsByDesignType, countsByCollection, motionStudies,
      countsByTrigger: await motionTriggerCounts(transaction),
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
