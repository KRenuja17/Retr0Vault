import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectionListResponseSchema,
  collectionResponseSchema,
  errorResponseSchema,
  type CreateCollectionInput,
} from "@retr0vault/shared";

import {
  createTestApp,
  disposeTestApp,
  type TestAppContext,
} from "./helpers.js";

const validCollectionInput: CreateCollectionInput = {
  name: "Reference Styles",
  slug: "reference-styles",
  description: "Pinned visual style references.",
  isPinned: true,
};

async function createCollection(
  context: TestAppContext,
  overrides: Partial<CreateCollectionInput> = {},
) {
  return context.app.inject({
    method: "POST",
    url: "/api/v1/collections",
    payload: { ...validCollectionInput, ...overrides },
  });
}

describe("collection API", () => {
  let context: TestAppContext;

  beforeEach(async () => {
    context = await createTestApp("collections");
  });

  afterEach(async () => {
    await disposeTestApp(context);
  });

  it("creates, lists, and updates collections", async () => {
    const createResponse = await createCollection(context, {
      name: "  Reference Styles  ",
      slug: undefined,
    });
    expect(createResponse.statusCode).toBe(201);
    const created = collectionResponseSchema.parse(createResponse.json());
    expect(created).toEqual({
      id: created.id,
      name: "Reference Styles",
      slug: "reference-styles",
      description: "Pinned visual style references.",
      isPinned: true,
      sortOrder: 0,
      referenceCount: 0,
    });

    const listResponse = await context.app.inject({
      method: "GET",
      url: "/api/v1/collections",
    });
    expect(collectionListResponseSchema.parse(listResponse.json())).toEqual([
      created,
    ]);

    const updateResponse = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/collections/${created.id}`,
      payload: {
        name: "Reference Directions",
        slug: "reference-directions",
        description: "Updated collection description.",
        isPinned: false,
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(collectionResponseSchema.parse(updateResponse.json())).toMatchObject({
      id: created.id,
      name: "Reference Directions",
      slug: "reference-directions",
      description: "Updated collection description.",
      isPinned: false,
    });
  });

  it("enforces unique slugs and validates collection input", async () => {
    expect((await createCollection(context)).statusCode).toBe(201);

    const conflictResponse = await createCollection(context, {
      name: "Duplicate",
    });
    expect(conflictResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(conflictResponse.json()).error.code).toBe(
      "COLLECTION_SLUG_CONFLICT",
    );

    const emptyNameResponse = await createCollection(context, {
      name: " ",
      slug: "empty-name",
    });
    expect(emptyNameResponse.statusCode).toBe(400);

    const unknownFieldResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/collections",
      payload: { ...validCollectionInput, colour: "orange" },
    });
    expect(unknownFieldResponse.statusCode).toBe(400);
  });

  it("normalizes collection ordering on create, move, and delete", async () => {
    const first = collectionResponseSchema.parse(
      (await createCollection(context)).json(),
    );
    const second = collectionResponseSchema.parse(
      (
        await createCollection(context, {
          name: "Second",
          slug: "second",
          sortOrder: 0,
        })
      ).json(),
    );
    const third = collectionResponseSchema.parse(
      (
        await createCollection(context, {
          name: "Third",
          slug: "third",
          sortOrder: 999,
        })
      ).json(),
    );

    const initial = collectionListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/collections",
        })
      ).json(),
    );
    expect(initial.map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      [second.id, 0],
      [first.id, 1],
      [third.id, 2],
    ]);

    expect(
      (
        await context.app.inject({
          method: "PATCH",
          url: `/api/v1/collections/${third.id}`,
          payload: { sortOrder: 0 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await context.app.inject({
          method: "DELETE",
          url: `/api/v1/collections/${second.id}`,
        })
      ).statusCode,
    ).toBe(204);

    const final = collectionListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/collections",
        })
      ).json(),
    );
    expect(final.map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      [third.id, 0],
      [first.id, 1],
    ]);
  });

  it("returns structured validation and not-found errors", async () => {
    const invalidId = await context.app.inject({
      method: "PATCH",
      url: "/api/v1/collections/not-a-uuid",
      payload: { name: "Valid" },
    });
    expect(invalidId.statusCode).toBe(400);

    const emptyPatch = await context.app.inject({
      method: "PATCH",
      url: "/api/v1/collections/00000000-0000-4000-8000-000000000001",
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const missingDelete = await context.app.inject({
      method: "DELETE",
      url: "/api/v1/collections/00000000-0000-4000-8000-000000000001",
    });
    expect(missingDelete.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missingDelete.json()).error.code).toBe(
      "COLLECTION_NOT_FOUND",
    );
  });
});
