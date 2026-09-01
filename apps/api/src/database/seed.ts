import type { DatabaseConnection } from "./connection.js";
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

export function seedDevelopmentData(
  connection: DatabaseConnection,
): SeedResult {
  developmentDesignTypes.forEach((designType, sortOrder) => {
    const { id, ...designTypeInput } = designType;
    const input = { ...designTypeInput, sortOrder };
    const existing = findDesignTypeBySlug(connection, designType.slug);

    if (existing === undefined) {
      createDesignType(connection, input, id);
    } else if (existing.id === id) {
      updateDesignType(connection, existing.id, input);
    } else {
      throw new ApiError(
        409,
        "SEED_SLUG_CONFLICT",
        `Development seed slug '${designType.slug}' belongs to non-seed data`,
      );
    }
  });

  const existingCollection = findCollectionBySlug(
    connection,
    referenceStylesCollection.slug,
  );
  const { id: collectionId, ...collectionInput } = referenceStylesCollection;
  if (existingCollection === undefined) {
    createCollection(connection, collectionInput, collectionId);
  } else if (existingCollection.id === collectionId) {
    updateCollection(connection, existingCollection.id, collectionInput);
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

export function clearDevelopmentData(
  connection: DatabaseConnection,
): SeedResult {
  let removedDesignTypes = 0;
  let removedCollections = 0;

  for (const designType of developmentDesignTypes) {
    const existing = findDesignTypeBySlug(connection, designType.slug);
    if (existing?.id === designType.id) {
      deleteDesignType(connection, existing.id);
      removedDesignTypes += 1;
    }
  }

  const existingCollection = findCollectionBySlug(
    connection,
    referenceStylesCollection.slug,
  );
  if (existingCollection?.id === referenceStylesCollection.id) {
    deleteCollection(connection, existingCollection.id);
    removedCollections += 1;
  }

  return {
    designTypes: removedDesignTypes,
    collections: removedCollections,
  };
}
