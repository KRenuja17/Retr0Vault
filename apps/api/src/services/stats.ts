import { sql, type SQL } from "drizzle-orm";

import { statsResponseSchema, type StatsResponse } from "@retr0vault/shared";

import { rowsOf, type Db } from "../database/connection.js";
import { motionTriggerCounts } from "./motion.js";
import type { Owner } from "./ownership.js";

/**
 * The archive's counts, for one account (`owner`), or the whole archive for
 * the local operator. The five queries are pipelined in one round trip rather
 * than run in a snapshot transaction, which over the network would cost more
 * than the counts themselves; counts taken while an import is writing may
 * briefly disagree.
 */
export async function getStats(db: Db, owner?: Owner): Promise<StatsResponse> {
  const mine = (column: SQL): SQL => (owner === undefined ? sql`true` : sql`${column} = ${owner}::uuid`);
  const [totalRows, countsByDesignType, countsByCollection, motionRows, countsByTrigger] = await Promise.all([
    db.execute(sql`
      select count(*)::integer as "totalReferences",
        count(*) filter (where analysis_status = 'pending')::integer as "pendingReferences",
        count(*) filter (where analysis_status = 'analyzed')::integer as "analyzedReferences",
        count(*) filter (where design_type_id is null)::integer as "unassignedReferences"
      from "references" r
      where ${mine(sql`r.owner_id`)}
    `).then((result) => rowsOf<Record<string, number>>(result)),
    db.execute(sql`
      select d.id, d.name, d.slug, count(r.id)::integer as "referenceCount"
      from design_types d left join "references" r on r.design_type_id = d.id and ${mine(sql`r.owner_id`)}
      group by d.id order by d.sort_order, d.id
    `).then((result) => rowsOf(result)),
    db.execute(sql`
      select c.id, c.name, c.slug, count(cr.reference_id)::integer as "referenceCount"
      from collections c left join collection_references cr on cr.collection_id = c.id
      where ${mine(sql`c.owner_id`)}
      group by c.id order by c.sort_order, c.id
    `).then((result) => rowsOf(result)),
    db.execute(sql`
      select count(*)::integer as total,
        count(*) filter (where s.motion_status = 'pending')::integer as pending,
        count(*) filter (where s.motion_status = 'analyzed')::integer as analyzed,
        count(*) filter (where s.motion_status = 'manual')::integer as manual,
        count(*) filter (where s.motion_status = 'failed')::integer as failed
      from motion_studies s join "references" r on r.id = s.reference_id
      where ${mine(sql`r.owner_id`)}
    `).then((result) => rowsOf<Record<string, number>>(result)),
    motionTriggerCounts(db, owner),
  ]);
  return statsResponseSchema.parse({
    ...totalRows[0], countsByDesignType, countsByCollection, motionStudies: motionRows[0], countsByTrigger,
  });
}
