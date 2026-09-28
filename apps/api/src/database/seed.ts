import type { Db } from "./connection.js";
import {
  developmentDesignTypes,
  referenceStylesCollection,
} from "./seed-data.js";
import {
  createCollection,
  deleteCollection,
  findCollectionBySlug,
  updateCollection,
} from "../services/collections.js";
import {
  createDesignType,
  deleteDesignType,
  findDesignTypeBySlug,
  updateDesignType,
} from "../services/design-types.js";
import { ApiError } from "../errors.js";

export interface SeedResult {
  readonly designTypes: number;
  readonly collections: number;
}

async function seedRecords(db: Db): Promise<SeedResult> {
  for (const [sortOrder, designType] of developmentDesignTypes.entries()) {
    const { id, ...designTypeInput } = designType;
    const input = { ...designTypeInput, sortOrder };
    const existing = await findDesignTypeBySlug(db, designType.slug);

    if (existing === undefined) {
      await createDesignType(db, input, id);
    } else if (existing.id === id) {
      await updateDesignType(db, existing.id, input);
    } else {
      throw new ApiError(
        409,
        "SEED_SLUG_CONFLICT",
        `Development seed slug '${designType.slug}' belongs to non-seed data`,
      );
    }
  }

  const existingCollection = await findCollectionBySlug(db, referenceStylesCollection.slug);
  const { id: collectionId, ...collectionInput } = referenceStylesCollection;
  if (existingCollection === undefined) {
    await createCollection(db, collectionInput, collectionId);
  } else if (existingCollection.id === collectionId) {
    await updateCollection(db, existingCollection.id, collectionInput);
  } else {
    throw new ApiError(
      409,
      "SEED_SLUG_CONFLICT",
      `Development seed slug '${referenceStylesCollection.slug}' belongs to non-seed data`,
    );
  }

  return {
    designTypes: developmentDesignTypes.length,
    collections: 1,
  };
}

async function clearSeedRecords(db: Db): Promise<SeedResult> {
  let removedDesignTypes = 0;
  let removedCollections = 0;

  for (const designType of developmentDesignTypes) {
    const existing = await findDesignTypeBySlug(db, designType.slug);
    if (existing?.id === designType.id) {
      await deleteDesignType(db, existing.id);
      removedDesignTypes += 1;
    }
  }

  const existingCollection = await findCollectionBySlug(db, referenceStylesCollection.slug);
  if (existingCollection?.id === referenceStylesCollection.id) {
    await deleteCollection(db, existingCollection.id);
    removedCollections += 1;
  }

  return {
    designTypes: removedDesignTypes,
    collections: removedCollections,
  };
}

export function seedDevelopmentData(db: Db): Promise<SeedResult> {
  return db.transaction((transaction) => seedRecords(transaction));
}

export function clearDevelopmentData(db: Db): Promise<SeedResult> {
  return db.transaction((transaction) => clearSeedRecords(transaction));
}
