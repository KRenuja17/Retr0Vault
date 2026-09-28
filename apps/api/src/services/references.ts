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

import type { Db } from "../database/connection.js";
import { renumber } from "../database/ordering.js";
import {
  collectionReferences,
  collections,
  designTypes,
  references,
  referenceFrames,
  referenceTags,
  tags,
} from "../database/schema.js";
import { ApiError, databaseErrorCode, PgCode } from "../errors.js";
import type { StoredReferenceImage, StoredWebsiteCapture } from "../storage/reference-storage.js";
import type { CreateWebsiteReferenceInput } from "@retr0vault/shared";
import { referenceSearchRank, searchQuery, searchWords } from "./reference-search.js";
import { motionSummaries } from "./motion.js";

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

async function findReferenceRow(db: Db, id: string): Promise<ReferenceRow> {
  const [row] = await db.select().from(references).where(eq(references.id, id));
  if (row === undefined) {
    throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
  }
  return row;
}

async function assertDesignTypeExists(db: Db, id: string | undefined | null): Promise<void> {
  if (id === undefined || id === null) return;
  const [row] = await db.select({ id: designTypes.id }).from(designTypes).where(eq(designTypes.id, id));
  if (row === undefined) {
    throw new ApiError(404, "DESIGN_TYPE_NOT_FOUND", "Design type not found");
  }
}

async function assertCollectionExists(db: Db, id: string): Promise<void> {
  const [row] = await db.select({ id: collections.id }).from(collections).where(eq(collections.id, id));
  if (row === undefined) {
    throw new ApiError(404, "COLLECTION_NOT_FOUND", "Collection not found");
  }
}

async function assertCollectionsExist(db: Db, collectionIds: string[] | undefined): Promise<void> {
  if (collectionIds === undefined) return;

  const uniqueIds = new Set(collectionIds);
  if (uniqueIds.size !== collectionIds.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "collectionIds: Collection identifiers must be unique");
  }

  if (collectionIds.length === 0) return;
  const existing = await db.select({ id: collections.id }).from(collections).where(inArray(collections.id, collectionIds));
  if (existing.length !== collectionIds.length) {
    throw new ApiError(404, "COLLECTION_NOT_FOUND", "One or more collections were not found");
  }
}

function normalizeTags(input: ReferenceTagInput[] | undefined): NormalizedTag[] | undefined {
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
      throw new ApiError(400, "VALIDATION_ERROR", "tags: Tag type/value combinations must be unique");
    }
    seen.add(key);
    return { type, value: tag.value, normalizedValue };
  });
}

function analysisObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored analysis JSON must be an object");
  }
  return value as Record<string, unknown>;
}

async function hydrateReferences(db: Db, rows: ReferenceRow[]): Promise<ReferenceResponse[]> {
  if (rows.length === 0) return [];

  const referenceIds = rows.map((row) => row.id);
  const [frameRows, tagRows, collectionRows, motionByReference] = await Promise.all([
    db.select().from(referenceFrames)
      .where(inArray(referenceFrames.referenceId, referenceIds)).orderBy(asc(referenceFrames.sortOrder)),
    db.select({
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
      .orderBy(asc(referenceTags.sortOrder)),
    db.select({ referenceId: collectionReferences.referenceId, collectionId: collectionReferences.collectionId })
      .from(collectionReferences)
      .innerJoin(collections, eq(collectionReferences.collectionId, collections.id))
      .where(inArray(collectionReferences.referenceId, referenceIds))
      .orderBy(asc(collections.sortOrder), asc(collections.name)),
    motionSummaries(db, referenceIds),
  ]);

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
      analysisJson: analysisObject(row.analysisJson),
      protectedFields: protectedFieldsSchema.parse(row.protectedFields),
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
      motion: motionByReference.get(row.id) ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function createImageReferenceRecord(
  db: Db,
  id: string,
  fields: CreateImageReferenceFields,
  image: StoredReferenceImage,
): Promise<ReferenceResponse> {
  await assertDesignTypeExists(db, fields.designTypeId);
  const now = new Date();

  await db.insert(references).values({
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
  });

  return getReference(db, id);
}

export async function getReference(db: Db, id: string): Promise<ReferenceResponse> {
  return (await hydrateReferences(db, [await findReferenceRow(db, id)]))[0]!;
}

export async function getReferenceMediaPaths(
  db: Db,
  id: string,
): Promise<Pick<ReferenceRow, "id" | "sourceType" | "originalPath" | "thumbnailPath">> {
  const [row] = await db.select({
    id: references.id, sourceType: references.sourceType, originalPath: references.originalPath, thumbnailPath: references.thumbnailPath,
  }).from(references).where(eq(references.id, id));
  if (row === undefined) throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
  return row;
}

/**
 * Point a reference at the picture that replaced its old one. Everything else
 * on the record stands; with `resetAnalysis` the reference is also filed back
 * as pending, the same as the analysis desk's reset, so the next exported
 * manifest carries the new picture.
 */
export async function replaceReferenceImageRecord(
  db: Db,
  id: string,
  image: StoredReferenceImage,
  resetAnalysis: boolean,
): Promise<ReferenceResponse> {
  await findReferenceRow(db, id);
  await db.update(references).set({
    originalPath: image.originalPath,
    thumbnailPath: image.thumbnailPath,
    imageWidth: image.width,
    imageHeight: image.height,
    imageFormat: image.format,
    ...(resetAnalysis ? { analysisStatus: "pending" as const } : {}),
    updatedAt: new Date(),
  }).where(eq(references.id, id));
  return getReference(db, id);
}

export async function createWebsiteReferenceRecord(
  db: Db,
  id: string,
  input: CreateWebsiteReferenceInput,
  capture: StoredWebsiteCapture,
): Promise<ReferenceResponse> {
  await assertDesignTypeExists(db, input.designTypeId);
  return db.transaction(async (transaction) => {
    const now = new Date();
    await transaction.insert(references).values({
      id, title: input.title ?? new URL(input.url).hostname, sourceType: "website", sourceUrl: input.url,
      originalPath: capture.originalPath, thumbnailPath: capture.thumbnailPath, designTypeId: input.designTypeId ?? null,
      imageWidth: capture.width, imageHeight: capture.height, imageFormat: capture.format,
      analysisStatus: "pending", createdAt: now, updatedAt: now,
    });
    if (capture.frames.length > 0) {
      await transaction.insert(referenceFrames).values(capture.frames.map((frame) => ({ id: randomUUID(), referenceId: id, ...frame })));
    }
    return getReference(transaction, id);
  });
}

/**
 * One catalogue page. Every database round trip costs a cloud hop, so the
 * filters are subqueries, the total and the page are fetched together, and
 * the page's relations in one more pipelined batch. (Without a snapshot
 * transaction, a total can briefly disagree with a page while an import is
 * writing; the next request agrees again.)
 */
export async function listReferences(db: Db, query: ReferenceListQuery): Promise<ReferenceListResponse> {
  const conditions: SQL[] = [];
  const emptyResult = () => referenceListResponseSchema.parse({
    items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0,
  });
  const words = query.q ? searchWords(query.q) : undefined;
  if (query.q && words === undefined) return emptyResult();
  if (words !== undefined) {
    conditions.push(sql`reference_search.document @@ ${searchQuery(words)}`);
  }

  // An unknown slug matches nothing, so the page is empty.
  if (query.designType !== undefined) {
    conditions.push(inArray(
      references.designTypeId,
      db.select({ id: designTypes.id }).from(designTypes).where(eq(designTypes.slug, query.designType)),
    ));
  }

  if (query.collection !== undefined) {
    conditions.push(inArray(
      references.id,
      db.select({ id: collectionReferences.referenceId })
        .from(collectionReferences)
        .innerJoin(collections, eq(collectionReferences.collectionId, collections.id))
        .where(eq(collections.slug, query.collection)),
    ));
  }

  if (query.status !== undefined) {
    conditions.push(eq(references.analysisStatus, query.status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const totalQuery = db.select({ value: count() }).from(references).$dynamic();
  const pageQuery = db.select(getTableColumns(references)).from(references).$dynamic();
  if (words !== undefined) {
    const joinCondition = sql`reference_search.reference_id = ${references.id}`;
    totalQuery.innerJoin(sql`reference_search`, joinCondition);
    pageQuery.innerJoin(sql`reference_search`, joinCondition);
  }
  const orderBy: SQL[] = query.sort === "relevance" && words !== undefined
    ? [sql`${referenceSearchRank(words)} desc`, desc(references.createdAt)]
    : query.sort === "oldest"
      ? [asc(references.createdAt)]
      : query.sort === "title-asc"
        ? [sql`lower(${references.title}) asc`]
        : query.sort === "title-desc"
          ? [sql`lower(${references.title}) desc`]
          : [desc(references.createdAt)];
  const offset = (query.page - 1) * query.limit;
  const [[totalRow], rows] = await Promise.all([
    totalQuery.where(whereClause),
    pageQuery
      .where(whereClause)
      .orderBy(...orderBy, asc(references.id))
      .limit(query.limit)
      .offset(offset),
  ]);
  const total = totalRow?.value ?? 0;

  return referenceListResponseSchema.parse({
    items: (await hydrateReferences(db, rows)).map((reference, index) =>
      query.includeCatalogueIndex
        ? { ...reference, catalogueIndex: offset + index + 1 }
        : reference),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  });
}

async function orderedCollectionMembers(db: Db, collectionId: string, excluding?: string): Promise<string[]> {
  const condition = excluding === undefined
    ? eq(collectionReferences.collectionId, collectionId)
    : and(eq(collectionReferences.collectionId, collectionId), ne(collectionReferences.referenceId, excluding));
  const rows = await db.select({ id: collectionReferences.referenceId }).from(collectionReferences)
    .where(condition)
    .orderBy(asc(collectionReferences.sortOrder), asc(collectionReferences.referenceId));
  return rows.map((row) => row.id);
}

function renumberCollection(db: Db, collectionId: string, referenceIds: readonly string[]): Promise<void> {
  return renumber(db, collectionReferences, collectionReferences.referenceId, referenceIds,
    sql`${collectionReferences.collectionId} = ${collectionId}::uuid`);
}

/** Removes tags no reference uses any longer. */
async function collectUnusedTags(db: Db): Promise<void> {
  await db.delete(tags).where(
    notExists(db.select({ id: referenceTags.tagId }).from(referenceTags).where(eq(referenceTags.tagId, tags.id))),
  );
}

export async function updateReference(
  db: Db,
  id: string,
  input: UpdateReferenceInput,
  options: { readonly protectEditedFields?: boolean } = {},
): Promise<ReferenceResponse> {
  const existing = await findReferenceRow(db, id);
  await assertDesignTypeExists(db, input.designTypeId);
  await assertCollectionsExist(db, input.collectionIds);
  const normalizedTags = normalizeTags(input.tags);

  try {
    await db.transaction(async (transaction) => {
      const values: Partial<typeof references.$inferInsert> = {
        updatedAt: new Date(),
      };
      const existingProtections = protectedFieldsSchema.parse(existing.protectedFields);
      const editedFields = options.protectEditedFields === false ? [] :
        protectedFieldSchema.options.filter((field) => input[field] !== undefined);
      const protections = input.protectedFields ?? [
        ...existingProtections,
        ...editedFields,
        ...(input.analysisStatus === "manual" ? protectedFieldSchema.options : []),
      ];
      values.protectedFields = [...new Set(protections)];
      if (input.title !== undefined) values.title = input.title;
      if (input.sourceUrl !== undefined) values.sourceUrl = input.sourceUrl;
      if (input.designTypeId !== undefined) values.designTypeId = input.designTypeId;
      if (input.designDNA !== undefined) values.designDNA = input.designDNA;
      if (input.designThesis !== undefined) values.designThesis = input.designThesis;
      if (input.designBrief !== undefined) values.designBrief = input.designBrief;
      if (input.imageRecipe !== undefined) values.imageRecipe = input.imageRecipe;
      if (input.motionBrief !== undefined) values.motionBrief = input.motionBrief;
      if (input.assetBrief !== undefined) values.assetBrief = input.assetBrief;
      if (input.analysisStatus !== undefined) values.analysisStatus = input.analysisStatus;
      if (input.analysisJson !== undefined) values.analysisJson = input.analysisJson;

      await transaction.update(references).set(values).where(eq(references.id, id));

      if (normalizedTags !== undefined) {
        await transaction.delete(referenceTags).where(eq(referenceTags.referenceId, id));

        if (normalizedTags.length > 0) {
          await transaction.insert(tags)
            .values(normalizedTags.map((tag) => ({ id: randomUUID(), type: tag.type, value: tag.value, normalizedValue: tag.normalizedValue })))
            .onConflictDoNothing();
          const tagRows = await transaction.select({ id: tags.id, type: tags.type, normalizedValue: tags.normalizedValue })
            .from(tags)
            .where(inArray(tags.normalizedValue, normalizedTags.map((tag) => tag.normalizedValue)));
          await transaction.insert(referenceTags).values(normalizedTags.map((tag, sortOrder) => {
            const row = tagRows.find((candidate) => candidate.type === tag.type && candidate.normalizedValue === tag.normalizedValue);
            if (row === undefined) throw new Error("Tag upsert failed");
            return { referenceId: id, tagId: row.id, sortOrder };
          }));
        }

        await collectUnusedTags(transaction);
      }

      if (input.collectionIds !== undefined) {
        const previousCollectionIds = (await transaction.select({ id: collectionReferences.collectionId })
          .from(collectionReferences)
          .where(eq(collectionReferences.referenceId, id))).map((row) => row.id);
        await transaction.delete(collectionReferences).where(eq(collectionReferences.referenceId, id));

        for (const collectionId of input.collectionIds) {
          const [size] = await transaction.select({ value: count() }).from(collectionReferences)
            .where(eq(collectionReferences.collectionId, collectionId));
          await transaction.insert(collectionReferences).values({ collectionId, referenceId: id, sortOrder: size?.value ?? 0 });
        }

        for (const collectionId of new Set([...previousCollectionIds, ...input.collectionIds])) {
          await renumberCollection(transaction, collectionId, await orderedCollectionMembers(transaction, collectionId));
        }
      }
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.foreignKeyViolation) {
      throw new ApiError(409, "REFERENCE_RELATION_CONFLICT", "A referenced design type or collection is unavailable");
    }
    throw error;
  }

  return getReference(db, id);
}

export async function deleteReferenceRecord(db: Db, id: string): Promise<DeletedReferenceFiles> {
  const row = await findReferenceRow(db, id);
  const framePaths = (await db.select({ path: referenceFrames.imagePath }).from(referenceFrames)
    .where(eq(referenceFrames.referenceId, id))).map((entry) => entry.path);

  try {
    await db.transaction(async (transaction) => {
      const affectedCollections = (await transaction.select({ id: collectionReferences.collectionId })
        .from(collectionReferences)
        .where(eq(collectionReferences.referenceId, id))).map((entry) => entry.id);

      await transaction.delete(references).where(eq(references.id, id));
      await collectUnusedTags(transaction);

      for (const collectionId of affectedCollections) {
        await renumberCollection(transaction, collectionId, await orderedCollectionMembers(transaction, collectionId));
      }
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.foreignKeyViolation) {
      throw new ApiError(409, "REFERENCE_IN_USE", "Reference cannot be deleted while protected records use it");
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

export async function addReferenceToCollection(
  db: Db,
  collectionId: string,
  referenceId: string,
  requestedSortOrder?: number,
): Promise<void> {
  await assertCollectionExists(db, collectionId);
  await findReferenceRow(db, referenceId);

  await db.transaction(async (transaction) => {
    const orderedIds = await orderedCollectionMembers(transaction, collectionId, referenceId);
    const position = requestedSortOrder === undefined
      ? orderedIds.length
      : Math.min(requestedSortOrder, orderedIds.length);

    await transaction.delete(collectionReferences).where(
      and(eq(collectionReferences.collectionId, collectionId), eq(collectionReferences.referenceId, referenceId)),
    );
    await transaction.insert(collectionReferences).values({ collectionId, referenceId, sortOrder: position });
    orderedIds.splice(position, 0, referenceId);
    await renumberCollection(transaction, collectionId, orderedIds);
  });
}

export async function removeReferenceFromCollection(
  db: Db,
  collectionId: string,
  referenceId: string,
): Promise<void> {
  await assertCollectionExists(db, collectionId);
  await findReferenceRow(db, referenceId);

  await db.transaction(async (transaction) => {
    await transaction.delete(collectionReferences).where(
      and(eq(collectionReferences.collectionId, collectionId), eq(collectionReferences.referenceId, referenceId)),
    );
    await renumberCollection(transaction, collectionId, await orderedCollectionMembers(transaction, collectionId));
  });
}
