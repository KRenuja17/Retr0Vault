import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, ne } from "drizzle-orm";

import {
  designTypeResponseSchema,
  type CreateDesignTypeInput,
  type DesignTypeResponse,
  type UpdateDesignTypeInput,
} from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
import { renumber } from "../database/ordering.js";
import {
  designTypeRules,
  designTypes,
  designTypeVocabulary,
  references,
} from "../database/schema.js";
import { ApiError, databaseErrorCode, PgCode } from "../errors.js";
import { slugFromName } from "../lib/slug.js";
import { ownedBy, type Owner } from "./ownership.js";

type DesignTypeRow = typeof designTypes.$inferSelect;

function insertPosition(requested: number | undefined, count: number): number {
  return requested === undefined ? count : Math.min(requested, count);
}

async function assertUniqueSlug(db: Db, slug: string, excludedId?: string): Promise<void> {
  const [existing] = await db.select({ id: designTypes.id }).from(designTypes).where(eq(designTypes.slug, slug));
  if (existing !== undefined && existing.id !== excludedId) {
    throw new ApiError(409, "DESIGN_TYPE_SLUG_CONFLICT", `A design type with slug '${slug}' already exists`);
  }
}

/** Design types are shared by every account; their reference counts are each account's own. */
async function hydrateDesignTypes(db: Db, rows: DesignTypeRow[], owner?: Owner): Promise<DesignTypeResponse[]> {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  const [rules, vocabulary, referenceCounts] = await Promise.all([
    db.select().from(designTypeRules).where(inArray(designTypeRules.designTypeId, ids)).orderBy(asc(designTypeRules.sortOrder)),
    db.select().from(designTypeVocabulary).where(inArray(designTypeVocabulary.designTypeId, ids)).orderBy(asc(designTypeVocabulary.sortOrder)),
    db.select({ designTypeId: references.designTypeId, value: count() })
      .from(references)
      .where(and(inArray(references.designTypeId, ids), ownedBy(references.ownerId, owner)))
      .groupBy(references.designTypeId),
  ]);

  const principlesByType = new Map<string, string[]>();
  const avoidByType = new Map<string, string[]>();
  const vocabularyByType = new Map<string, string[]>();
  const referenceCountByType = new Map<string, number>();

  for (const rule of rules) {
    const target = rule.kind === "principle" ? principlesByType : avoidByType;
    const entries = target.get(rule.designTypeId) ?? [];
    entries.push(rule.text);
    target.set(rule.designTypeId, entries);
  }

  for (const entry of vocabulary) {
    const entries = vocabularyByType.get(entry.designTypeId) ?? [];
    entries.push(entry.term);
    vocabularyByType.set(entry.designTypeId, entries);
  }

  for (const entry of referenceCounts) {
    if (entry.designTypeId !== null) {
      referenceCountByType.set(entry.designTypeId, entry.value);
    }
  }

  return rows.map((row) =>
    designTypeResponseSchema.parse({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      deployFor: row.deployFor,
      risk: row.risk,
      briefBlock: row.briefBlock,
      sortOrder: row.sortOrder,
      principles: principlesByType.get(row.id) ?? [],
      avoid: avoidByType.get(row.id) ?? [],
      vocabulary: vocabularyByType.get(row.id) ?? [],
      referenceCount: referenceCountByType.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

async function findDesignTypeRowById(db: Db, id: string): Promise<DesignTypeRow> {
  const [row] = await db.select().from(designTypes).where(eq(designTypes.id, id));
  if (row === undefined) {
    throw new ApiError(404, "DESIGN_TYPE_NOT_FOUND", "Design type not found");
  }
  return row;
}

async function orderedDesignTypeIds(db: Db, excluding?: string): Promise<string[]> {
  const rows = await db.select({ id: designTypes.id }).from(designTypes)
    .where(excluding === undefined ? undefined : ne(designTypes.id, excluding))
    .orderBy(asc(designTypes.sortOrder), asc(designTypes.name));
  return rows.map((row) => row.id);
}

async function insertRules(db: Db, designTypeId: string, kind: "principle" | "avoid", texts: readonly string[]): Promise<void> {
  if (texts.length === 0) return;
  await db.insert(designTypeRules).values(texts.map((text, sortOrder) => ({ id: randomUUID(), designTypeId, kind, text, sortOrder })));
}

async function insertVocabulary(db: Db, designTypeId: string, terms: readonly string[]): Promise<void> {
  if (terms.length === 0) return;
  await db.insert(designTypeVocabulary).values(terms.map((term, sortOrder) => ({ id: randomUUID(), designTypeId, term, sortOrder })));
}

export async function listDesignTypes(db: Db, owner?: Owner): Promise<DesignTypeResponse[]> {
  const rows = await db.select().from(designTypes).orderBy(asc(designTypes.sortOrder), asc(designTypes.name));
  return hydrateDesignTypes(db, rows, owner);
}

export async function getDesignTypeById(db: Db, id: string, owner?: Owner): Promise<DesignTypeResponse> {
  return (await hydrateDesignTypes(db, [await findDesignTypeRowById(db, id)], owner))[0]!;
}

export async function findDesignTypeBySlug(db: Db, slug: string, owner?: Owner): Promise<DesignTypeResponse | undefined> {
  const [row] = await db.select().from(designTypes).where(eq(designTypes.slug, slug));
  return row === undefined ? undefined : (await hydrateDesignTypes(db, [row], owner))[0]!;
}

export async function getDesignTypeBySlug(db: Db, slug: string, owner?: Owner): Promise<DesignTypeResponse> {
  const designType = await findDesignTypeBySlug(db, slug, owner);
  if (designType === undefined) {
    throw new ApiError(404, "DESIGN_TYPE_NOT_FOUND", "Design type not found");
  }
  return designType;
}

export async function createDesignType(
  db: Db,
  input: CreateDesignTypeInput,
  id: string = randomUUID(),
): Promise<DesignTypeResponse> {
  const slug = input.slug ?? slugFromName(input.name);
  const now = new Date();

  await assertUniqueSlug(db, slug);

  try {
    await db.transaction(async (transaction) => {
      const orderedIds = await orderedDesignTypeIds(transaction);
      const position = insertPosition(input.sortOrder, orderedIds.length);

      await transaction.insert(designTypes).values({
        id,
        slug,
        name: input.name,
        description: input.description,
        deployFor: input.deployFor,
        risk: input.risk,
        briefBlock: input.briefBlock,
        sortOrder: position,
        createdAt: now,
        updatedAt: now,
      });

      orderedIds.splice(position, 0, id);
      await renumber(transaction, designTypes, designTypes.id, orderedIds);
      await insertRules(transaction, id, "principle", input.principles);
      await insertRules(transaction, id, "avoid", input.avoid);
      await insertVocabulary(transaction, id, input.vocabulary);
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.uniqueViolation) {
      throw new ApiError(409, "DESIGN_TYPE_SLUG_CONFLICT", `A design type with slug '${slug}' already exists`);
    }
    throw error;
  }

  return getDesignTypeById(db, id);
}

export async function updateDesignType(
  db: Db,
  id: string,
  input: UpdateDesignTypeInput,
): Promise<DesignTypeResponse> {
  await findDesignTypeRowById(db, id);

  if (input.slug !== undefined) {
    await assertUniqueSlug(db, input.slug, id);
  }

  try {
    await db.transaction(async (transaction) => {
      const values: Partial<typeof designTypes.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) values.name = input.name;
      if (input.slug !== undefined) values.slug = input.slug;
      if (input.description !== undefined) values.description = input.description;
      if (input.deployFor !== undefined) values.deployFor = input.deployFor;
      if (input.risk !== undefined) values.risk = input.risk;
      if (input.briefBlock !== undefined) values.briefBlock = input.briefBlock;

      await transaction.update(designTypes).set(values).where(eq(designTypes.id, id));

      if (input.sortOrder !== undefined) {
        const orderedIds = await orderedDesignTypeIds(transaction, id);
        orderedIds.splice(insertPosition(input.sortOrder, orderedIds.length), 0, id);
        await renumber(transaction, designTypes, designTypes.id, orderedIds);
      }

      if (input.principles !== undefined) {
        await transaction.delete(designTypeRules).where(and(eq(designTypeRules.designTypeId, id), eq(designTypeRules.kind, "principle")));
        await insertRules(transaction, id, "principle", input.principles);
      }

      if (input.avoid !== undefined) {
        await transaction.delete(designTypeRules).where(and(eq(designTypeRules.designTypeId, id), eq(designTypeRules.kind, "avoid")));
        await insertRules(transaction, id, "avoid", input.avoid);
      }

      if (input.vocabulary !== undefined) {
        await transaction.delete(designTypeVocabulary).where(eq(designTypeVocabulary.designTypeId, id));
        await insertVocabulary(transaction, id, input.vocabulary);
      }
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.uniqueViolation) {
      throw new ApiError(409, "DESIGN_TYPE_SLUG_CONFLICT", "The requested design type slug or vocabulary already exists");
    }
    throw error;
  }

  return getDesignTypeById(db, id);
}

export async function deleteDesignType(db: Db, id: string): Promise<void> {
  await findDesignTypeRowById(db, id);

  try {
    await db.transaction(async (transaction) => {
      await transaction.delete(designTypes).where(eq(designTypes.id, id));
      await renumber(transaction, designTypes, designTypes.id, await orderedDesignTypeIds(transaction));
    });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.foreignKeyViolation) {
      throw new ApiError(409, "DESIGN_TYPE_IN_USE", "Design type cannot be deleted while references use it");
    }
    throw error;
  }
}
