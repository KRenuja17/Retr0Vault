import { sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { Db } from "./connection.js";

/*
 * Renumbers `sort_order` for `ids` to 0, 1, 2… in two statements, whatever the
 * list length (each statement is one round trip to the database).
 *
 * Rows are first parked far outside the live range, so a unique index on the
 * order (motion clips, reference tags, vocabulary) never sees two rows sharing
 * a value mid-update: Postgres checks unique indexes row by row.
 */
export async function renumber(
  db: Db,
  table: PgTable,
  key: PgColumn,
  ids: readonly string[],
  scope?: SQL,
): Promise<void> {
  if (ids.length === 0) return;
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const within = scope === undefined ? sql`${key} in (${idList})` : sql`${key} in (${idList}) and ${scope}`;
  await db.execute(sql`update ${table} set sort_order = sort_order + 100000 where ${within}`);
  const cases = sql.join(ids.map((id, index) => sql`when ${key} = ${id}::uuid then ${index}::integer`), sql` `);
  await db.execute(sql`update ${table} set sort_order = case ${cases} end where ${within}`);
}
