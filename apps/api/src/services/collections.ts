import { randomUUID } from "node:crypto";

import { and, asc, count, eq, isNull, ne } from "drizzle-orm";

import {
  collectionResponseSchema,
  type CollectionResponse,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
import { renumber } from "../database/ordering.js";
import { collectionReferences, collections } from "../database/schema.js";
import { ApiError, databaseErrorCode, PgCode } from "../errors.js";
import { slugFromName } from "../lib/slug.js";
import { ownedBy, type Owner } from "./ownership.js";

type CollectionRow = typeof collections.$inferSelect;

function insertPosition(requested: number | undefined, count: number): number {
  return requested === undefined ? count : Math.min(requested, count);
}

function serializeCollection(row: CollectionRow, referenceCount: number = 0): CollectionResponse {
  return collectionResponseSchema.parse({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isPinned: row.isPinned,
    sortOrder: row.sortOrder,
    referenceCount,
  });
}

async function collectionReferenceCount(db: Db, id: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(collectionReferences).where(eq(collectionReferences.collectionId, id));
  return row?.value ?? 0;
}

async function findCollectionRowById(db: Db, id: string): Promise<CollectionRow> {
  const [row] = await db.select().from(collections).where(eq(collections.id, id));
  if (row === undefined) {
    throw new ApiError(404, "COLLECTION_NOT_FOUND", "Collection not found");
  }
  return row;
}

/** Each account (and the unowned rows) names its collections on its own. */
const sameOwner = (ownerId: string | null) => (ownerId === null ? isNull(collections.ownerId) : eq(collections.ownerId, ownerId));

async function assertUniqueSlug(db: Db, slug: string, ownerId: string | null, excludedId?: string): Promise<void> {
  const [existing] = await db.select({ id: collections.id }).from(collections)
    .where(and(eq(collections.slug, slug), sameOwner(ownerId)));
  if (existing !== undefined && existing.id !== excludedId) {
    throw new ApiError(409, "COLLECTION_SLUG_CONFLICT", `A collection with slug '${slug}' already exists`);
  }
}

async function orderedCollectionIds(db: Db, ownerId: string | null, excluding?: string): Promise<string[]> {
  const rows = await db.select({ id: collections.id }).from(collections)
    .where(and(sameOwner(ownerId), excluding === undefined ? undefined : ne(collections.id, excluding)))
    .orderBy(asc(collections.sortOrder), asc(collections.name));
  return rows.map((row) => row.id);
}

export async function listCollections(db: Db, owner?: Owner): Promise<CollectionResponse[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(collections).where(ownedBy(collections.ownerId, owner)).orderBy(asc(collections.sortOrder), asc(collections.name)),
    db.select({ collectionId: collectionReferences.collectionId, value: count() })
      .from(collectionReferences)
      .groupBy(collectionReferences.collectionId),
  ]);
  const countsByCollection = new Map(counts.map((entry) => [entry.collectionId, entry.value]));
  return rows.map((row) => serializeCollection(row, countsByCollection.get(row.id) ?? 0));
}

export async function findCollectionBySlug(db: Db, slug: string, owner?: Owner): Promise<CollectionResponse | undefined> {
  const [row] = await db.select().from(collections).where(and(eq(collections.slug, slug), ownedBy(collections.ownerId, owner)));
  if (row === undefined) return undefined;
  return serializeCollection(row, await collectionReferenceCount(db, row.id));
}

export async function createCollection(
  db: Db,
  input: CreateCollectionInput,
  id: string = randomUUID(),
  ownerId: string | null = null,
): Promise<CollectionResponse> {
  const slug = input.slug ?? slugFromName(input.name);

  await assertUniqueSlug(db, slug, ownerId);

  try {
    await db.transaction(async (transaction) => {
      const orderedIds = await orderedCollectionIds(transaction, ownerId);
      const position = insertPosition(input.sortOrder, orderedIds.length);

      await transaction.insert(collections).values({
        id,
        slug,
        name: input.name,
        description: input.description,
        isPinned: input.isPinned,
        sortOrder: position,
        ownerId,
      });

      orderedIds.splice(position, 0, id);
      await renumber(transaction, collections, collections.id, orderedIds);
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.uniqueViolation) {
      throw new ApiError(409, "COLLECTION_SLUG_CONFLICT", `A collection with slug '${slug}' already exists`);
    }
    throw error;
  }

  return serializeCollection(await findCollectionRowById(db, id), await collectionReferenceCount(db, id));
}

export async function updateCollection(
  db: Db,
  id: string,
  input: UpdateCollectionInput,
): Promise<CollectionResponse> {
  const { ownerId } = await findCollectionRowById(db, id);

  if (input.slug !== undefined) {
    await assertUniqueSlug(db, input.slug, ownerId, id);
  }

  try {
    await db.transaction(async (transaction) => {
      const values: Partial<typeof collections.$inferInsert> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.slug !== undefined) values.slug = input.slug;
      if (input.description !== undefined) values.description = input.description;
      if (input.isPinned !== undefined) values.isPinned = input.isPinned;

      if (Object.keys(values).length > 0) {
        await transaction.update(collections).set(values).where(eq(collections.id, id));
      }

      if (input.sortOrder !== undefined) {
        const orderedIds = await orderedCollectionIds(transaction, ownerId, id);
        orderedIds.splice(insertPosition(input.sortOrder, orderedIds.length), 0, id);
        await renumber(transaction, collections, collections.id, orderedIds);
      }
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.uniqueViolation) {
      throw new ApiError(409, "COLLECTION_SLUG_CONFLICT", "The requested collection slug already exists");
    }
    throw error;
  }

  return serializeCollection(await findCollectionRowById(db, id), await collectionReferenceCount(db, id));
}

export async function deleteCollection(db: Db, id: string): Promise<void> {
  const { ownerId } = await findCollectionRowById(db, id);

  try {
    await db.transaction(async (transaction) => {
      await transaction.delete(collections).where(eq(collections.id, id));
      await renumber(transaction, collections, collections.id, await orderedCollectionIds(transaction, ownerId));
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.foreignKeyViolation) {
      throw new ApiError(409, "COLLECTION_IN_USE", "Collection cannot be deleted while protected memberships use it");
    }
    throw error;
  }
}
