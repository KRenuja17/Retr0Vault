import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseConnection } from "../src/database/connection.js";
import {
  clearDevelopmentData,
  seedDevelopmentData,
} from "../src/database/seed.js";
import {
  createCollection,
  listCollections,
} from "../src/services/collections.js";
import { listDesignTypes } from "../src/services/design-types.js";
import { createTestDatabase, TEST_USER } from "./helpers.js";

describe("development seed data", () => {
  let connection: DatabaseConnection;

  beforeEach(async () => {
    connection = await createTestDatabase();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("is representative, pinned, idempotent, and easy to remove", async () => {
    const db = connection.database;
    await createCollection(db, {
      name: "Personal Keepers",
      slug: "personal-keepers",
      description: "Non-seed data that must survive seed cleanup.",
      isPinned: false,
    }, undefined, TEST_USER.id);

    expect(await seedDevelopmentData(db)).toEqual({
      designTypes: 7,
      collections: 1,
    });
    expect(await seedDevelopmentData(db)).toEqual({
      designTypes: 7,
      collections: 1,
    });

    const designTypes = await listDesignTypes(db);
    expect(designTypes.map(({ name }) => name)).toEqual([
      "Print-Tech Paper",
      "Dither Mono",
      "Vast Quiet Cinematic",
      "Data-as-Texture",
      "Classical Remix",
      "Glitched Antiquity",
      "Illustrated Storybook",
    ]);
    expect(designTypes.map(({ sortOrder }) => sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(designTypes.every(({ vocabulary }) => vocabulary.length >= 6)).toBe(
      true,
    );

    const collections = await listCollections(db);
    expect(collections).toHaveLength(2);
    expect(
      collections.find(({ slug }) => slug === "reference-styles"),
    ).toMatchObject({
      name: "Reference Styles",
      isPinned: true,
      referenceCount: 0,
    });

    expect(await clearDevelopmentData(db)).toEqual({
      designTypes: 7,
      collections: 1,
    });
    expect(await listDesignTypes(db)).toEqual([]);
    expect((await listCollections(db)).map(({ slug }) => slug)).toEqual([
      "personal-keepers",
    ]);
  });
});
