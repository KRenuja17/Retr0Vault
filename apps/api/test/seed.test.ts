import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection } from "../src/database/connection.js";
import { applyMigrations } from "../src/database/migrate.js";
import {
  clearDevelopmentData,
  seedDevelopmentData,
} from "../src/database/seed.js";
import {
  createCollection,
  listCollections,
} from "../src/services/collections.js";
import { listDesignTypes } from "../src/services/design-types.js";

describe("development seed data", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-seed-"));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it("is representative, pinned, idempotent, and easy to remove", () => {
    const connection = createDatabaseConnection(join(directory, "seed.db"));

    try {
      applyMigrations(connection);
      createCollection(connection, {
        name: "Personal Keepers",
        slug: "personal-keepers",
        description: "Non-seed data that must survive seed cleanup.",
        isPinned: false,
      });

      expect(seedDevelopmentData(connection)).toEqual({
        designTypes: 7,
        collections: 1,
      });
      expect(seedDevelopmentData(connection)).toEqual({
        designTypes: 7,
        collections: 1,
      });

      const designTypes = listDesignTypes(connection);
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

      const collections = listCollections(connection);
      expect(collections).toHaveLength(2);
      expect(
        collections.find(({ slug }) => slug === "reference-styles"),
      ).toMatchObject({
        name: "Reference Styles",
        isPinned: true,
        referenceCount: 0,
      });

      expect(clearDevelopmentData(connection)).toEqual({
        designTypes: 7,
        collections: 1,
      });
      expect(listDesignTypes(connection)).toEqual([]);
      expect(listCollections(connection).map(({ slug }) => slug)).toEqual([
        "personal-keepers",
      ]);
    } finally {
      connection.sqlite.close();
    }
  });
});
