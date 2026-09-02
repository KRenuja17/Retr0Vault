import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  ne,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  protectedFieldSchema,
  protectedFieldsSchema,
  referenceListResponseSchema,
  referenceResponseSchema,
  type CreateImageReferenceFields,
  type ReferenceListQuery,
  type ReferenceListResponse,
  type ReferenceResponse,
  type ReferenceTagInput,
  type UpdateReferenceInput,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import {
  collectionReferences,
  collections,
  designTypes,
  references,
  referenceFrames,
  referenceTags,
  tags,
} from "../database/schema.js";
import { ApiError, sqliteErrorCode } from "../errors.js";
import type { StoredReferenceImage, StoredWebsiteCapture } from "../storage/reference-storage.js";
import type { CreateWebsiteReferenceInput } from "@retr0vault/shared";
import { referenceSearchExpression, referenceSearchRank } from "./reference-search.js";

type ReferenceRow = typeof references.$inferSelect;

interface NormalizedTag extends ReferenceTagInput {
  readonly normalizedValue: string;
}

export interface DeletedReferenceFiles {
  readonly id: string;
  readonly originalPath: string;
  readonly thumbnailPath: string;
  readonly framePaths: string[];
}

function findReferenceRow(
  connection: DatabaseConnection,
  id: string,
): ReferenceRow {
  const row = connection.database
    .select()
    .from(references)
    .where(eq(references.id, id))
    .get();

  if (row === undefined) {
    throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
  }

  return row;
}

function assertDesignTypeExists(
  connection: DatabaseConnection,
  id: string | undefined | null,
): void {
  if (id === undefined || id === null) return;

  const row = connection.database
    .select({ id: designTypes.id })
    .from(designTypes)
    .where(eq(designTypes.id, id))
    .get();
  if (row === undefined) {
    throw new ApiError(404, "DESIGN_TYPE_NOT_FOUND", "Design type not found");
  }
}

function assertCollectionExists(
  connection: DatabaseConnection,
  id: string,
): void {
  const row = connection.database
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.id, id))
    .get();
  if (row === undefined) {
    throw new ApiError(404, "COLLECTION_NOT_FOUND", "Collection not found");
  }
}

function assertCollectionsExist(
  connection: DatabaseConnection,
  collectionIds: string[] | undefined,
): void {
  if (collectionIds === undefined) return;

  const uniqueIds = new Set(collectionIds);
  if (uniqueIds.size !== collectionIds.length) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "collectionIds: Collection identifiers must be unique",
    );
  }

  if (collectionIds.length === 0) return;
  const existing = connection.database
    .select({ id: collections.id })
    .from(collections)
    .where(inArray(collections.id, collectionIds))
    .all();
  if (existing.length !== collectionIds.length) {
    throw new ApiError(
      404,
      "COLLECTION_NOT_FOUND",
      "One or more collections were not found",
    );
  }
}

function normalizeTags(input: ReferenceTagInput[] | undefined):
  | NormalizedTag[]
  | undefined {
  if (input === undefined) return undefined;

  const seen = new Set<string>();
  return input.map((tag) => {
    const type = tag.type.toLocaleLowerCase("en-US");
    const normalizedValue = tag.value
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("en-US");
    const key = `${type}\u0000${normalizedValue}`;
    if (seen.has(key)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "tags: Tag type/value combinations must be unique",
      );
    }
    seen.add(key);
    return { type, value: tag.value, normalizedValue };
  });
}

function parseAnalysisJson(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;

  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Stored analysis JSON must be an object");
  }
  return parsed as Record<string, unknown>;
}

function hydrateReferences(
  connection: DatabaseConnection,
  rows: ReferenceRow[],
): ReferenceResponse[] {
  if (rows.length === 0) return [];

  const referenceIds = rows.map((row) => row.id);
  const frameRows = connection.database.select().from(referenceFrames)
    .where(inArray(referenceFrames.referenceId, referenceIds)).orderBy(asc(referenceFrames.sortOrder)).all();
  const tagRows = connection.database
    .select({
      referenceId: referenceTags.referenceId,
      id: tags.id,
      type: tags.type,
      value: tags.value,
      normalizedValue: tags.normalizedValue,
      sortOrder: referenceTags.sortOrder,
    })
    .from(referenceTags)
    .innerJoin(tags, eq(referenceTags.tagId, tags.id))
    .where(inArray(referenceTags.referenceId, referenceIds))
    .orderBy(asc(referenceTags.sortOrder))
    .all();
  const collectionRows = connection.database
    .select({
      referenceId: collectionReferences.referenceId,
      collectionId: collectionReferences.collectionId,
    })
    .from(collectionReferences)
    .innerJoin(
      collections,
      eq(collectionReferences.collectionId, collections.id),
    )
    .where(inArray(collectionReferences.referenceId, referenceIds))
    .orderBy(asc(collections.sortOrder), asc(collections.name))
    .all();

  const tagsByReference = new Map<string, typeof tagRows>();
  for (const row of tagRows) {
    const entries = tagsByReference.get(row.referenceId) ?? [];
    entries.push(row);
    tagsByReference.set(row.referenceId, entries);
  }
  const collectionsByReference = new Map<string, string[]>();
  for (const row of collectionRows) {
    const entries = collectionsByReference.get(row.referenceId) ?? [];
    entries.push(row.collectionId);
    collectionsByReference.set(row.referenceId, entries);
  }

  return rows.map((row) =>
    referenceResponseSchema.parse({
      id: row.id,
      title: row.title,
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      originalPath: row.originalPath,
      thumbnailPath: row.thumbnailPath,
      designTypeId: row.designTypeId,
      designDNA: row.designDNA,
      designThesis: row.designThesis,
      designBrief: row.designBrief,
      imageRecipe: row.imageRecipe,
      motionBrief: row.motionBrief,
      assetBrief: row.assetBrief,
      analysisStatus: row.analysisStatus,
      analysisJson: parseAnalysisJson(row.analysisJson),
      protectedFields: protectedFieldsSchema.parse(JSON.parse(row.protectedFields)),
      image: {
        width: row.imageWidth,
        height: row.imageHeight,
        format: row.imageFormat,
      },
      tags: (tagsByReference.get(row.id) ?? []).map((tag) => ({
        id: tag.id,
        type: tag.type,
        value: tag.value,
        normalizedValue: tag.normalizedValue,
        sortOrder: tag.sortOrder,
      })),
      collectionIds: collectionsByReference.get(row.id) ?? [],
      frames: frameRows.filter((frame) => frame.referenceId === row.id),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export function createImageReferenceRecord(
  connection: DatabaseConnection,
  id: string,
  fields: CreateImageReferenceFields,
  image: StoredReferenceImage,
): ReferenceResponse {
  assertDesignTypeExists(connection, fields.designTypeId);
  const now = new Date();

  connection.database
    .insert(references)
    .values({
      id,
      title: fields.title,
      sourceType: "image",
      sourceUrl: fields.sourceUrl ?? null,
      originalPath: image.originalPath,
      thumbnailPath: image.thumbnailPath,
      designTypeId: fields.designTypeId ?? null,
      analysisStatus: "pending",
      imageWidth: image.width,
      imageHeight: image.height,
      imageFormat: image.format,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return hydrateReferences(connection, [findReferenceRow(connection, id)])[0]!;
}

export function getReference(
  connection: DatabaseConnection,
  id: string,
): ReferenceResponse {
  return hydrateReferences(connection, [findReferenceRow(connection, id)])[0]!;
}

export function getReferenceMediaPaths(
  connection: DatabaseConnection,
  id: string,
): Pick<ReferenceRow, "id" | "originalPath" | "thumbnailPath"> {
  const row = connection.database.select({ id: references.id, originalPath: references.originalPath, thumbnailPath: references.thumbnailPath })
    .from(references).where(eq(references.id, id)).get();
  if (row === undefined) throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
  return row;
}

export function createWebsiteReferenceRecord(
  connection: DatabaseConnection,
  id: string,
  input: CreateWebsiteReferenceInput,
  capture: StoredWebsiteCapture,
): ReferenceResponse {
  assertDesignTypeExists(connection, input.designTypeId);
  return connection.database.transaction((transaction) => {
    const now = new Date();
    transaction.insert(references).values({
      id, title: input.title ?? new URL(input.url).hostname, sourceType: "website", sourceUrl: input.url,
      originalPath: capture.originalPath, thumbnailPath: capture.thumbnailPath, designTypeId: input.designTypeId ?? null,
      imageWidth: capture.width, imageHeight: capture.height, imageFormat: capture.format,
      analysisStatus: "pending", createdAt: now, updatedAt: now,
    }).run();
    for (const frame of capture.frames) {
      transaction.insert(referenceFrames).values({ id: randomUUID(), referenceId: id, ...frame }).run();
    }
    return getReference(connection, id);
  });
}

export function listReferences(
  connection: DatabaseConnection,
  query: ReferenceListQuery,
): ReferenceListResponse {
  // Keep the total, page rows, and hydrated relations on one read snapshot,
  // including when a separate analysis-import CLI is writing concurrently.
  return connection.database.transaction(() => queryReferences(connection, query));
}

function queryReferences(
  connection: DatabaseConnection,
  query: ReferenceListQuery,
): ReferenceListResponse {
  const conditions: SQL[] = [];
  const emptyResult = () => referenceListResponseSchema.parse({
    items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0,
  });
  const searchExpression = query.q ? referenceSearchExpression(query.q) : undefined;
  if (query.q && searchExpression === undefined) return emptyResult();
  if (searchExpression !== undefined) {
    conditions.push(sql`reference_search MATCH ${searchExpression}`);
  }

  if (query.designType !== undefined) {
    const designType = connection.database
      .select({ id: designTypes.id })
      .from(designTypes)
      .where(eq(designTypes.slug, query.designType))
      .get();
    if (designType === undefined) {
      return emptyResult();
    }
    conditions.push(eq(references.designTypeId, designType.id));
  }

  if (query.collection !== undefined) {
    const collection = connection.database
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.slug, query.collection))
      .get();
    if (collection === undefined) {
      return emptyResult();
    }
    conditions.push(
      inArray(
        references.id,
        connection.database
          .select({ id: collectionReferences.referenceId })
          .from(collectionReferences)
          .where(eq(collectionReferences.collectionId, collection.id)),
      ),
    );
  }

  if (query.status !== undefined) {
    conditions.push(eq(references.analysisStatus, query.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const totalQuery = connection.database.select({ value: count() })
    .from(references).$dynamic();
  const pageQuery = connection.database.select(getTableColumns(references))
    .from(references).$dynamic();
  if (searchExpression !== undefined) {
    const joinCondition = sql`reference_search.reference_id = ${references.id}`;
    totalQuery.innerJoin(sql`reference_search`, joinCondition);
    pageQuery.innerJoin(sql`reference_search`, joinCondition);
  }
  const total = totalQuery.where(whereClause).get()?.value ?? 0;
  const orderBy: SQL[] = query.sort === "relevance" && searchExpression !== undefined
    ? [referenceSearchRank, desc(references.createdAt)]
    : query.sort === "oldest"
      ? [asc(references.createdAt)]
      : query.sort === "title-asc"
        ? [sql`${references.title} collate nocase asc`]
        : query.sort === "title-desc"
          ? [sql`${references.title} collate nocase desc`]
          : [desc(references.createdAt)];
  const offset = (query.page - 1) * query.limit;
  const rows = pageQuery
    .where(whereClause)
    .orderBy(...orderBy, asc(references.id))
    .limit(query.limit)
    .offset(offset)
    .all();

  return referenceListResponseSchema.parse({
    items: hydrateReferences(connection, rows).map((reference, index) =>
      query.includeCatalogueIndex
        ? { ...reference, catalogueIndex: offset + index + 1 }
        : reference),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  });
}

export function updateReference(
  connection: DatabaseConnection,
  id: string,
  input: UpdateReferenceInput,
  options: { readonly protectEditedFields?: boolean } = {},
): ReferenceResponse {
  const existing = findReferenceRow(connection, id);
  assertDesignTypeExists(connection, input.designTypeId);
  assertCollectionsExist(connection, input.collectionIds);
  const normalizedTags = normalizeTags(input.tags);

  try {
    connection.database.transaction((transaction) => {
      const values: Partial<typeof references.$inferInsert> = {
        updatedAt: new Date(),
      };
      const existingProtections = protectedFieldsSchema.parse(JSON.parse(existing.protectedFields));
      const editedFields = options.protectEditedFields === false ? [] :
        protectedFieldSchema.options.filter((field) => input[field] !== undefined);
      const protections = input.protectedFields ?? [
        ...existingProtections,
        ...editedFields,
        ...(input.analysisStatus === "manual" ? protectedFieldSchema.options : []),
      ];
      values.protectedFields = JSON.stringify([...new Set(protections)]);
      if (input.title !== undefined) values.title = input.title;
      if (input.sourceUrl !== undefined) values.sourceUrl = input.sourceUrl;
      if (input.designTypeId !== undefined)
        values.designTypeId = input.designTypeId;
      if (input.designDNA !== undefined) values.designDNA = input.designDNA;
      if (input.designThesis !== undefined)
        values.designThesis = input.designThesis;
      if (input.designBrief !== undefined) values.designBrief = input.designBrief;
      if (input.imageRecipe !== undefined) values.imageRecipe = input.imageRecipe;
      if (input.motionBrief !== undefined) values.motionBrief = input.motionBrief;
      if (input.assetBrief !== undefined) values.assetBrief = input.assetBrief;
      if (input.analysisStatus !== undefined)
        values.analysisStatus = input.analysisStatus;
      if (input.analysisJson !== undefined)
        values.analysisJson =
          input.analysisJson === null ? null : JSON.stringify(input.analysisJson);

      transaction
        .update(references)
        .set(values)
        .where(eq(references.id, id))
        .run();

      if (normalizedTags !== undefined) {
        transaction
          .delete(referenceTags)
          .where(eq(referenceTags.referenceId, id))
          .run();

        normalizedTags.forEach((tag, sortOrder) => {
          transaction
            .insert(tags)
            .values({
              id: randomUUID(),
              type: tag.type,
              value: tag.value,
              normalizedValue: tag.normalizedValue,
            })
            .onConflictDoNothing()
            .run();
          const tagRow = transaction
            .select({ id: tags.id })
            .from(tags)
            .where(
              and(
                eq(tags.type, tag.type),
                eq(tags.normalizedValue, tag.normalizedValue),
              ),
            )
            .get();
          if (tagRow === undefined) {
            throw new Error("Tag upsert failed");
          }
          transaction
            .insert(referenceTags)
            .values({ referenceId: id, tagId: tagRow.id, sortOrder })
            .run();
        });

        transaction
          .delete(tags)
          .where(
            notExists(
              transaction
                .select({ id: referenceTags.tagId })
                .from(referenceTags)
                .where(eq(referenceTags.tagId, tags.id)),
            ),
          )
          .run();
      }

      if (input.collectionIds !== undefined) {
        const previousCollectionIds = transaction
          .select({ id: collectionReferences.collectionId })
          .from(collectionReferences)
          .where(eq(collectionReferences.referenceId, id))
          .all()
          .map((row) => row.id);
        transaction
          .delete(collectionReferences)
          .where(eq(collectionReferences.referenceId, id))
          .run();

        for (const collectionId of input.collectionIds) {
          const collectionSize =
            transaction
              .select({ value: count() })
              .from(collectionReferences)
              .where(eq(collectionReferences.collectionId, collectionId))
              .get()?.value ?? 0;
          transaction
            .insert(collectionReferences)
            .values({ collectionId, referenceId: id, sortOrder: collectionSize })
            .run();
        }

        const affectedCollections = new Set([
          ...previousCollectionIds,
          ...input.collectionIds,
        ]);
        for (const collectionId of affectedCollections) {
          const orderedIds = transaction
            .select({ id: collectionReferences.referenceId })
            .from(collectionReferences)
            .where(eq(collectionReferences.collectionId, collectionId))
            .orderBy(
              asc(collectionReferences.sortOrder),
              asc(collectionReferences.referenceId),
            )
            .all()
            .map((row) => row.id);
          orderedIds.forEach((referenceId, sortOrder) => {
            transaction
              .update(collectionReferences)
              .set({ sortOrder })
              .where(
                and(
                  eq(collectionReferences.collectionId, collectionId),
                  eq(collectionReferences.referenceId, referenceId),
                ),
              )
              .run();
          });
        }
      }
    });
  } catch (error) {
    const code = sqliteErrorCode(error);
    if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      throw new ApiError(
        409,
        "REFERENCE_RELATION_CONFLICT",
        "A referenced design type or collection is unavailable",
      );
    }
    throw error;
  }

  return getReference(connection, id);
}

export function deleteReferenceRecord(
  connection: DatabaseConnection,
  id: string,
): DeletedReferenceFiles {
  const row = findReferenceRow(connection, id);
  const framePaths = connection.database.select({ path: referenceFrames.imagePath }).from(referenceFrames)
    .where(eq(referenceFrames.referenceId, id)).all().map((entry) => entry.path);

  try {
    connection.database.transaction((transaction) => {
      const affectedCollections = transaction
        .select({ id: collectionReferences.collectionId })
        .from(collectionReferences)
        .where(eq(collectionReferences.referenceId, id))
        .all()
        .map((entry) => entry.id);

      transaction.delete(references).where(eq(references.id, id)).run();
      transaction
        .delete(tags)
        .where(
          notExists(
            transaction
              .select({ id: referenceTags.tagId })
              .from(referenceTags)
              .where(eq(referenceTags.tagId, tags.id)),
          ),
        )
        .run();

      for (const collectionId of affectedCollections) {
        const remainingIds = transaction
          .select({ id: collectionReferences.referenceId })
          .from(collectionReferences)
          .where(eq(collectionReferences.collectionId, collectionId))
          .orderBy(
            asc(collectionReferences.sortOrder),
            asc(collectionReferences.referenceId),
          )
          .all()
          .map((entry) => entry.id);
        remainingIds.forEach((referenceId, sortOrder) => {
          transaction
            .update(collectionReferences)
            .set({ sortOrder })
            .where(
              and(
                eq(collectionReferences.collectionId, collectionId),
                eq(collectionReferences.referenceId, referenceId),
              ),
            )
            .run();
        });
      }
    });
  } catch (error) {
    const code = sqliteErrorCode(error);
    if (
      code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
      code === "SQLITE_CONSTRAINT_TRIGGER"
    ) {
      throw new ApiError(
        409,
        "REFERENCE_IN_USE",
        "Reference cannot be deleted while protected records use it",
      );
    }
    throw error;
  }

  return {
    id: row.id,
    originalPath: row.originalPath,
    thumbnailPath: row.thumbnailPath,
    framePaths,
  };
}

export function addReferenceToCollection(
  connection: DatabaseConnection,
  collectionId: string,
  referenceId: string,
  requestedSortOrder?: number,
): void {
  assertCollectionExists(connection, collectionId);
  findReferenceRow(connection, referenceId);

  connection.database.transaction((transaction) => {
    const orderedIds = transaction
      .select({ id: collectionReferences.referenceId })
      .from(collectionReferences)
      .where(
        and(
          eq(collectionReferences.collectionId, collectionId),
          ne(collectionReferences.referenceId, referenceId),
        ),
      )
      .orderBy(
        asc(collectionReferences.sortOrder),
        asc(collectionReferences.referenceId),
      )
      .all()
      .map((row) => row.id);
    const position =
      requestedSortOrder === undefined
        ? orderedIds.length
        : Math.min(requestedSortOrder, orderedIds.length);

    transaction
      .delete(collectionReferences)
      .where(
        and(
          eq(collectionReferences.collectionId, collectionId),
          eq(collectionReferences.referenceId, referenceId),
        ),
      )
      .run();
    transaction
      .insert(collectionReferences)
      .values({ collectionId, referenceId, sortOrder: position })
      .run();
    orderedIds.splice(position, 0, referenceId);
    orderedIds.forEach((id, sortOrder) => {
      transaction
        .update(collectionReferences)
        .set({ sortOrder })
        .where(
          and(
            eq(collectionReferences.collectionId, collectionId),
            eq(collectionReferences.referenceId, id),
          ),
        )
        .run();
    });
  });
}

export function removeReferenceFromCollection(
  connection: DatabaseConnection,
  collectionId: string,
  referenceId: string,
): void {
  assertCollectionExists(connection, collectionId);
  findReferenceRow(connection, referenceId);

  connection.database.transaction((transaction) => {
    transaction
      .delete(collectionReferences)
      .where(
        and(
          eq(collectionReferences.collectionId, collectionId),
          eq(collectionReferences.referenceId, referenceId),
        ),
      )
      .run();
    const orderedIds = transaction
      .select({ id: collectionReferences.referenceId })
      .from(collectionReferences)
      .where(eq(collectionReferences.collectionId, collectionId))
      .orderBy(
        asc(collectionReferences.sortOrder),
        asc(collectionReferences.referenceId),
      )
      .all()
      .map((row) => row.id);
    orderedIds.forEach((id, sortOrder) => {
      transaction
        .update(collectionReferences)
        .set({ sortOrder })
        .where(
          and(
            eq(collectionReferences.collectionId, collectionId),
            eq(collectionReferences.referenceId, id),
          ),
        )
        .run();
    });
  });
}
