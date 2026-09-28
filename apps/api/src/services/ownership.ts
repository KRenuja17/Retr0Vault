import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { Db } from "../database/connection.js";
import { collections, motionClips, motionStudies, references } from "../database/schema.js";
import { ApiError } from "../errors.js";

/*
 * Every reference and collection belongs to one account, and an account sees
 * only its own: another account's rows answer exactly as missing ones do (404),
 * so their existence is not given away.
 *
 * `owner` is the signed-in account's id. The command-line tools run as the
 * local operator and pass `undefined`, which scopes nothing.
 */
export type Owner = string | undefined;

/** A condition limiting `column` to the owner's rows; nothing for the operator. */
export function ownedBy(column: PgColumn, owner: Owner): SQL | undefined {
  return owner === undefined ? undefined : eq(column, owner);
}

export async function assertOwnedReference(db: Db, referenceId: string, owner: Owner): Promise<void> {
  if (owner === undefined) return;
  const [row] = await db.select({ id: references.id }).from(references)
    .where(and(eq(references.id, referenceId), eq(references.ownerId, owner)));
  if (row === undefined) throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
}

export async function assertOwnedReferences(db: Db, referenceIds: readonly string[], owner: Owner): Promise<void> {
  if (owner === undefined || referenceIds.length === 0) return;
  const unique = [...new Set(referenceIds)];
  const rows = await db.select({ id: references.id }).from(references)
    .where(and(inArray(references.id, unique), eq(references.ownerId, owner)));
  if (rows.length !== unique.length) throw new ApiError(404, "REFERENCE_NOT_FOUND", "One or more references were not found");
}

export async function assertOwnedCollections(db: Db, collectionIds: readonly string[], owner: Owner): Promise<void> {
  if (owner === undefined || collectionIds.length === 0) return;
  const unique = [...new Set(collectionIds)];
  const rows = await db.select({ id: collections.id }).from(collections)
    .where(and(inArray(collections.id, unique), eq(collections.ownerId, owner)));
  if (rows.length !== unique.length) {
    throw new ApiError(404, "COLLECTION_NOT_FOUND", unique.length === 1 ? "Collection not found" : "One or more collections were not found");
  }
}

export async function assertOwnedClip(db: Db, clipId: string, owner: Owner): Promise<void> {
  if (owner === undefined) return;
  const [row] = await db.select({ id: motionClips.id }).from(motionClips)
    .innerJoin(motionStudies, eq(motionClips.motionStudyId, motionStudies.id))
    .innerJoin(references, eq(motionStudies.referenceId, references.id))
    .where(and(eq(motionClips.id, clipId), eq(references.ownerId, owner)));
  if (row === undefined) throw new ApiError(404, "MOTION_CLIP_NOT_FOUND", "Motion clip not found");
}
