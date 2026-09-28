import { randomUUID } from "node:crypto";

import { asc, count, eq, ne } from "drizzle-orm";

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

async function assertUniqueSlug(db: Db, slug: string, excludedId?: string): Promise<void> {
  const [existing] = await db.select({ id: collections.id }).from(collections).where(eq(collections.slug, slug));
  if (existing !== undefined && existing.id !== excludedId) {
    throw new ApiError(409, "COLLECTION_SLUG_CONFLICT", `A collection with slug '${slug}' already exists`);
  }
}

async function orderedCollectionIds(db: Db, excluding?: string): Promise<string[]> {
  const rows = await db.select({ id: collections.id }).from(collections)
    .where(excluding === undefined ? undefined : ne(collections.id, excluding))
    .orderBy(asc(collections.sortOrder), asc(collections.name));
  return rows.map((row) => row.id);
}

export async function listCollections(db: Db): Promise<CollectionResponse[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(collections).orderBy(asc(collections.sortOrder), asc(collections.name)),
    db.select({ collectionId: collectionReferences.collectionId, value: count() })
      .from(collectionReferences)
      .groupBy(collectionReferences.collectionId),
  ]);
  const countsByCollection = new Map(counts.map((entry) => [entry.collectionId, entry.value]));
  return rows.map((row) => serializeCollection(row, countsByCollection.get(row.id) ?? 0));
}

export async function findCollectionBySlug(db: Db, slug: string): Promise<CollectionResponse | undefined> {
  const [row] = await db.select().from(collections).where(eq(collections.slug, slug));
  if (row === undefined) return undefined;
  return serializeCollection(row, await collectionReferenceCount(db, row.id));
}

export async function createCollection(
  db: Db,
  input: CreateCollectionInput,
  id: string = randomUUID(),
): Promise<CollectionResponse> {
  const slug = input.slug ?? slugFromName(input.name);

  await assertUniqueSlug(db, slug);

  try {
    await db.transaction(async (transaction) => {
      const orderedIds = await orderedCollectionIds(transaction);
      const position = insertPosition(input.sortOrder, orderedIds.length);

      await transaction.insert(collections).values({
        id,
        slug,
        name: input.name,
        description: input.description,
        isPinned: input.isPinned,
        sortOrder: position,
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
  await findCollectionRowById(db, id);

  if (input.slug !== undefined) {
    await assertUniqueSlug(db, input.slug, id);
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
        const orderedIds = await orderedCollectionIds(transaction, id);
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
  await findCollectionRowById(db, id);

  try {
    await db.transaction(async (transaction) => {
      await transaction.delete(collections).where(eq(collections.id, id));
      await renumber(transaction, collections, collections.id, await orderedCollectionIds(transaction));
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.foreignKeyViolation) {
      throw new ApiError(409, "COLLECTION_IN_USE", "Collection cannot be deleted while protected memberships use it");
    }
    throw error;
  }
}
