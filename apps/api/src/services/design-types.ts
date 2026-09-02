import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, ne } from "drizzle-orm";

import {
  designTypeResponseSchema,
  type CreateDesignTypeInput,
  type DesignTypeResponse,
  type UpdateDesignTypeInput,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import {
  designTypeRules,
  designTypes,
  designTypeVocabulary,
  references,
} from "../database/schema.js";
import { ApiError, sqliteErrorCode } from "../errors.js";
import { slugFromName } from "../lib/slug.js";

type DesignTypeRow = typeof designTypes.$inferSelect;

function insertPosition(requested: number | undefined, count: number): number {
  return requested === undefined ? count : Math.min(requested, count);
}

function assertUniqueSlug(
  connection: DatabaseConnection,
  slug: string,
  excludedId?: string,
): void {
  const existing = connection.database
    .select({ id: designTypes.id })
    .from(designTypes)
    .where(eq(designTypes.slug, slug))
    .get();

  if (existing !== undefined && existing.id !== excludedId) {
    throw new ApiError(
      409,
      "DESIGN_TYPE_SLUG_CONFLICT",
      `A design type with slug '${slug}' already exists`,
    );
  }
}

function hydrateDesignTypes(
  connection: DatabaseConnection,
  rows: DesignTypeRow[],
): DesignTypeResponse[] {
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  const rules = connection.database
    .select()
    .from(designTypeRules)
    .where(inArray(designTypeRules.designTypeId, ids))
    .orderBy(asc(designTypeRules.sortOrder))
    .all();
  const vocabulary = connection.database
    .select()
    .from(designTypeVocabulary)
    .where(inArray(designTypeVocabulary.designTypeId, ids))
    .orderBy(asc(designTypeVocabulary.sortOrder))
    .all();
  const referenceCounts = connection.database
    .select({ designTypeId: references.designTypeId, value: count() })
    .from(references)
    .where(inArray(references.designTypeId, ids))
    .groupBy(references.designTypeId)
    .all();

  const principlesByType = new Map<string, string[]>();
  const avoidByType = new Map<string, string[]>();
  const vocabularyByType = new Map<string, string[]>();
  const referenceCountByType = new Map<string, number>();

  for (const rule of rules) {
    const target =
      rule.kind === "principle" ? principlesByType : avoidByType;
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

function findDesignTypeRowById(
  connection: DatabaseConnection,
  id: string,
): DesignTypeRow {
  const row = connection.database
    .select()
    .from(designTypes)
    .where(eq(designTypes.id, id))
    .get();

  if (row === undefined) {
    throw new ApiError(404, "DESIGN_TYPE_NOT_FOUND", "Design type not found");
  }

  return row;
}

export function listDesignTypes(
  connection: DatabaseConnection,
): DesignTypeResponse[] {
  const rows = connection.database
    .select()
    .from(designTypes)
    .orderBy(asc(designTypes.sortOrder), asc(designTypes.name))
    .all();

  return hydrateDesignTypes(connection, rows);
}

export function getDesignTypeById(
  connection: DatabaseConnection,
  id: string,
): DesignTypeResponse {
  return hydrateDesignTypes(connection, [findDesignTypeRowById(connection, id)])[0]!;
}

export function findDesignTypeBySlug(
  connection: DatabaseConnection,
  slug: string,
): DesignTypeResponse | undefined {
  const row = connection.database
    .select()
    .from(designTypes)
    .where(eq(designTypes.slug, slug))
    .get();

  return row === undefined
    ? undefined
    : hydrateDesignTypes(connection, [row])[0]!;
}

export function getDesignTypeBySlug(
  connection: DatabaseConnection,
  slug: string,
): DesignTypeResponse {
  const designType = findDesignTypeBySlug(connection, slug);

  if (designType === undefined) {
    throw new ApiError(404, "DESIGN_TYPE_NOT_FOUND", "Design type not found");
  }

  return designType;
}

export function createDesignType(
  connection: DatabaseConnection,
  input: CreateDesignTypeInput,
  id: string = randomUUID(),
): DesignTypeResponse {
  const slug = input.slug ?? slugFromName(input.name);
  const now = new Date();

  assertUniqueSlug(connection, slug);

  try {
    connection.database.transaction((transaction) => {
      const orderedIds = transaction
        .select({ id: designTypes.id })
        .from(designTypes)
        .orderBy(asc(designTypes.sortOrder), asc(designTypes.name))
        .all()
        .map((row) => row.id);
      const position = insertPosition(input.sortOrder, orderedIds.length);

      transaction
        .insert(designTypes)
        .values({
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
        })
        .run();

      orderedIds.splice(position, 0, id);
      orderedIds.forEach((designTypeId, sortOrder) => {
        transaction
          .update(designTypes)
          .set({ sortOrder })
          .where(eq(designTypes.id, designTypeId))
          .run();
      });

      input.principles.forEach((text, sortOrder) => {
        transaction
          .insert(designTypeRules)
          .values({
            id: randomUUID(),
            designTypeId: id,
            kind: "principle",
            text,
            sortOrder,
          })
          .run();
      });
      input.avoid.forEach((text, sortOrder) => {
        transaction
          .insert(designTypeRules)
          .values({
            id: randomUUID(),
            designTypeId: id,
            kind: "avoid",
            text,
            sortOrder,
          })
          .run();
      });
      input.vocabulary.forEach((term, sortOrder) => {
        transaction
          .insert(designTypeVocabulary)
          .values({
            id: randomUUID(),
            designTypeId: id,
            term,
            sortOrder,
          })
          .run();
      });
    });
  } catch (error) {
    if (sqliteErrorCode(error) === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new ApiError(
        409,
        "DESIGN_TYPE_SLUG_CONFLICT",
        `A design type with slug '${slug}' already exists`,
      );
    }
    throw error;
  }

  return hydrateDesignTypes(connection, [findDesignTypeRowById(connection, id)])[0]!;
}

export function updateDesignType(
  connection: DatabaseConnection,
  id: string,
  input: UpdateDesignTypeInput,
): DesignTypeResponse {
  findDesignTypeRowById(connection, id);

  if (input.slug !== undefined) {
    assertUniqueSlug(connection, input.slug, id);
  }

  try {
    connection.database.transaction((transaction) => {
      const values: Partial<typeof designTypes.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) values.name = input.name;
      if (input.slug !== undefined) values.slug = input.slug;
      if (input.description !== undefined) values.description = input.description;
      if (input.deployFor !== undefined) values.deployFor = input.deployFor;
      if (input.risk !== undefined) values.risk = input.risk;
      if (input.briefBlock !== undefined) values.briefBlock = input.briefBlock;

      transaction
        .update(designTypes)
        .set(values)
        .where(eq(designTypes.id, id))
        .run();

      if (input.sortOrder !== undefined) {
        const orderedIds = transaction
          .select({ id: designTypes.id })
          .from(designTypes)
          .where(ne(designTypes.id, id))
          .orderBy(asc(designTypes.sortOrder), asc(designTypes.name))
          .all()
          .map((row) => row.id);
        orderedIds.splice(
          insertPosition(input.sortOrder, orderedIds.length),
          0,
          id,
        );
        orderedIds.forEach((designTypeId, sortOrder) => {
          transaction
            .update(designTypes)
            .set({ sortOrder })
            .where(eq(designTypes.id, designTypeId))
            .run();
        });
      }

      if (input.principles !== undefined) {
        transaction
          .delete(designTypeRules)
          .where(
            and(
              eq(designTypeRules.designTypeId, id),
              eq(designTypeRules.kind, "principle"),
            ),
          )
          .run();
        input.principles.forEach((text, sortOrder) => {
          transaction
            .insert(designTypeRules)
            .values({
              id: randomUUID(),
              designTypeId: id,
              kind: "principle",
              text,
              sortOrder,
            })
            .run();
        });
      }

      if (input.avoid !== undefined) {
        transaction
          .delete(designTypeRules)
          .where(
            and(
              eq(designTypeRules.designTypeId, id),
              eq(designTypeRules.kind, "avoid"),
            ),
          )
          .run();
        input.avoid.forEach((text, sortOrder) => {
          transaction
            .insert(designTypeRules)
            .values({
              id: randomUUID(),
              designTypeId: id,
              kind: "avoid",
              text,
              sortOrder,
            })
            .run();
        });
      }

      if (input.vocabulary !== undefined) {
        transaction
          .delete(designTypeVocabulary)
          .where(eq(designTypeVocabulary.designTypeId, id))
          .run();
        input.vocabulary.forEach((term, sortOrder) => {
          transaction
            .insert(designTypeVocabulary)
            .values({ id: randomUUID(), designTypeId: id, term, sortOrder })
            .run();
        });
      }
    });
  } catch (error) {
    if (sqliteErrorCode(error) === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new ApiError(
        409,
        "DESIGN_TYPE_SLUG_CONFLICT",
        "The requested design type slug or vocabulary already exists",
      );
    }
    throw error;
  }

  return hydrateDesignTypes(connection, [findDesignTypeRowById(connection, id)])[0]!;
}

export function deleteDesignType(
  connection: DatabaseConnection,
  id: string,
): void {
  findDesignTypeRowById(connection, id);

  try {
    connection.database.transaction((transaction) => {
      transaction.delete(designTypes).where(eq(designTypes.id, id)).run();

      const orderedIds = transaction
        .select({ id: designTypes.id })
        .from(designTypes)
        .orderBy(asc(designTypes.sortOrder), asc(designTypes.name))
        .all()
        .map((row) => row.id);
      orderedIds.forEach((designTypeId, sortOrder) => {
        transaction
          .update(designTypes)
          .set({ sortOrder })
          .where(eq(designTypes.id, designTypeId))
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
        "DESIGN_TYPE_IN_USE",
        "Design type cannot be deleted while references use it",
      );
    }
    throw error;
  }
}
