import { randomUUID } from "node:crypto";

import { asc, count, eq, ne } from "drizzle-orm";

import {
  collectionResponseSchema,
  type CollectionResponse,
  type CreateCollectionInput,
  type UpdateCollectionInput,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { collectionReferences, collections } from "../database/schema.js";
import { ApiError, sqliteErrorCode } from "../errors.js";
import { slugFromName } from "../lib/slug.js";

type CollectionRow = typeof collections.$inferSelect;

function insertPosition(requested: number | undefined, count: number): number {
  return requested === undefined ? count : Math.min(requested, count);
}

function serializeCollection(
  row: CollectionRow,
  referenceCount: number = 0,
): CollectionResponse {
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

function collectionReferenceCount(connection: DatabaseConnection, id: string): number {
  return connection.database
    .select({ value: count() })
    .from(collectionReferences)
    .where(eq(collectionReferences.collectionId, id))
    .get()?.value ?? 0;
}

function findCollectionRowById(
  connection: DatabaseConnection,
  id: string,
): CollectionRow {
  const row = connection.database
    .select()
    .from(collections)
    .where(eq(collections.id, id))
    .get();

  if (row === undefined) {
    throw new ApiError(404, "COLLECTION_NOT_FOUND", "Collection not found");
  }

  return row;
}

function assertUniqueSlug(
  connection: DatabaseConnection,
  slug: string,
  excludedId?: string,
): void {
  const existing = connection.database
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.slug, slug))
    .get();

  if (existing !== undefined && existing.id !== excludedId) {
    throw new ApiError(
      409,
      "COLLECTION_SLUG_CONFLICT",
      `A collection with slug '${slug}' already exists`,
    );
  }
}

export function listCollections(
  connection: DatabaseConnection,
): CollectionResponse[] {
  const rows = connection.database
    .select()
    .from(collections)
    .orderBy(asc(collections.sortOrder), asc(collections.name))
    .all();
  const counts = connection.database
    .select({ collectionId: collectionReferences.collectionId, value: count() })
    .from(collectionReferences)
    .groupBy(collectionReferences.collectionId)
    .all();
  const countsByCollection = new Map(
    counts.map((entry) => [entry.collectionId, entry.value]),
  );
  return rows.map((row) =>
    serializeCollection(row, countsByCollection.get(row.id) ?? 0),
  );
}

export function findCollectionBySlug(
  connection: DatabaseConnection,
  slug: string,
): CollectionResponse | undefined {
  const row = connection.database
    .select()
    .from(collections)
    .where(eq(collections.slug, slug))
    .get();

  if (row === undefined) return undefined;
  return serializeCollection(row, collectionReferenceCount(connection, row.id));
}

export function createCollection(
  connection: DatabaseConnection,
  input: CreateCollectionInput,
  id: string = randomUUID(),
): CollectionResponse {
  const slug = input.slug ?? slugFromName(input.name);

  assertUniqueSlug(connection, slug);

  try {
    connection.database.transaction((transaction) => {
      const orderedIds = transaction
        .select({ id: collections.id })
        .from(collections)
        .orderBy(asc(collections.sortOrder), asc(collections.name))
        .all()
        .map((row) => row.id);
      const position = insertPosition(input.sortOrder, orderedIds.length);

      transaction
        .insert(collections)
        .values({
          id,
          slug,
          name: input.name,
          description: input.description,
          isPinned: input.isPinned,
          sortOrder: position,
        })
        .run();

      orderedIds.splice(position, 0, id);
      orderedIds.forEach((collectionId, sortOrder) => {
        transaction
          .update(collections)
          .set({ sortOrder })
          .where(eq(collections.id, collectionId))
          .run();
      });
    });
  } catch (error) {
    if (sqliteErrorCode(error) === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new ApiError(
        409,
        "COLLECTION_SLUG_CONFLICT",
        `A collection with slug '${slug}' already exists`,
      );
    }
    throw error;
  }

  return serializeCollection(findCollectionRowById(connection, id), collectionReferenceCount(connection, id));
}

export function updateCollection(
  connection: DatabaseConnection,
  id: string,
  input: UpdateCollectionInput,
): CollectionResponse {
  findCollectionRowById(connection, id);

  if (input.slug !== undefined) {
    assertUniqueSlug(connection, input.slug, id);
  }

  try {
    connection.database.transaction((transaction) => {
      const values: Partial<typeof collections.$inferInsert> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.slug !== undefined) values.slug = input.slug;
      if (input.description !== undefined) values.description = input.description;
      if (input.isPinned !== undefined) values.isPinned = input.isPinned;

      if (Object.keys(values).length > 0) {
        transaction
          .update(collections)
          .set(values)
          .where(eq(collections.id, id))
          .run();
      }

      if (input.sortOrder !== undefined) {
        const orderedIds = transaction
          .select({ id: collections.id })
          .from(collections)
          .where(ne(collections.id, id))
          .orderBy(asc(collections.sortOrder), asc(collections.name))
          .all()
          .map((row) => row.id);
        orderedIds.splice(
          insertPosition(input.sortOrder, orderedIds.length),
          0,
          id,
        );
        orderedIds.forEach((collectionId, sortOrder) => {
          transaction
            .update(collections)
            .set({ sortOrder })
            .where(eq(collections.id, collectionId))
            .run();
        });
      }
    });
  } catch (error) {
    if (sqliteErrorCode(error) === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new ApiError(
        409,
        "COLLECTION_SLUG_CONFLICT",
        "The requested collection slug already exists",
      );
    }
    throw error;
  }

  return serializeCollection(findCollectionRowById(connection, id), collectionReferenceCount(connection, id));
}

export function deleteCollection(
  connection: DatabaseConnection,
  id: string,
): void {
  findCollectionRowById(connection, id);

  try {
    connection.database.transaction((transaction) => {
      transaction.delete(collections).where(eq(collections.id, id)).run();

      const orderedIds = transaction
        .select({ id: collections.id })
        .from(collections)
        .orderBy(asc(collections.sortOrder), asc(collections.name))
        .all()
        .map((row) => row.id);
      orderedIds.forEach((collectionId, sortOrder) => {
        transaction
          .update(collections)
          .set({ sortOrder })
          .where(eq(collections.id, collectionId))
          .run();
      });
    });
  } catch (error) {
    const code = sqliteErrorCode(error);
    if (
      code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      code === "SQLITE_CONSTRAINT_TRIGGER"
    ) {
      throw new ApiError(
        409,
        "COLLECTION_IN_USE",
        "Collection cannot be deleted while protected memberships use it",
      );
    }
    throw error;
  }
}
