import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  designTypeListResponseSchema,
  designTypeResponseSchema,
  errorResponseSchema,
  type CreateDesignTypeInput,
} from "@retr0vault/shared";

import {
  createTestApp,
  disposeTestApp,
  type TestAppContext,
  validDesignTypeInput,
} from "./helpers.js";

async function createDesignType(
  context: TestAppContext,
  overrides: Partial<CreateDesignTypeInput> = {},
) {
  return context.app.inject({
    method: "POST",
    url: "/api/v1/design-types",
    payload: { ...validDesignTypeInput, ...overrides },
  });
}

describe("design type API", () => {
  let context: TestAppContext;

  beforeEach(async () => {
    context = await createTestApp("design-types");
  });

  afterEach(async () => {
    await disposeTestApp(context);
  });

  it("creates, lists, reads, and updates a complete style guide", async () => {
    const createdResponse = await createDesignType(context, {
      name: "  Editorial Signal  ",
      slug: undefined,
      principles: ["  Lead with the image  ", "Keep labels compact"],
      avoid: ["  Avoid generic cards  "],
      vocabulary: ["  editorial crop  ", "mono labels"],
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = designTypeResponseSchema.parse(createdResponse.json());
    expect(created).toMatchObject({
      name: "Editorial Signal",
      slug: "editorial-signal",
      principles: ["Lead with the image", "Keep labels compact"],
      avoid: ["Avoid generic cards"],
      vocabulary: ["editorial crop", "mono labels"],
      referenceCount: 0,
      sortOrder: 0,
    });

    const listResponse = await context.app.inject({
      method: "GET",
      url: "/api/v1/design-types",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(designTypeListResponseSchema.parse(listResponse.json())).toHaveLength(1);

    const detailResponse = await context.app.inject({
      method: "GET",
      url: `/api/v1/design-types/${created.slug}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(designTypeResponseSchema.parse(detailResponse.json()).id).toBe(
      created.id,
    );

    const updatedResponse = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/design-types/${created.id}`,
      payload: {
        name: "Editorial Frequency",
        slug: "editorial-frequency",
        deployFor: "Independent publications and studios.",
        principles: ["Use one dominant editorial frequency"],
        avoid: [],
        vocabulary: ["frequency bars"],
      },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(designTypeResponseSchema.parse(updatedResponse.json())).toMatchObject({
      id: created.id,
      name: "Editorial Frequency",
      slug: "editorial-frequency",
      deployFor: "Independent publications and studios.",
      principles: ["Use one dominant editorial frequency"],
      avoid: [],
      vocabulary: ["frequency bars"],
    });

    const oldSlugResponse = await context.app.inject({
      method: "GET",
      url: "/api/v1/design-types/editorial-signal",
    });
    expect(oldSlugResponse.statusCode).toBe(404);
  });

  it.each([
    ["principles", [" "]],
    ["avoid", [""]],
    ["vocabulary", ["\t"]],
  ] as const)("rejects empty %s entries", async (field, value) => {
    const response = await createDesignType(context, { [field]: value });
    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("rejects duplicate vocabulary and unknown input fields", async () => {
    const duplicateResponse = await createDesignType(context, {
      vocabulary: ["Film Grain", "film grain"],
    });
    expect(duplicateResponse.statusCode).toBe(400);

    const unknownFieldResponse = await context.app.inject({
      method: "POST",
      url: "/api/v1/design-types",
      payload: { ...validDesignTypeInput, unexpected: true },
    });
    expect(unknownFieldResponse.statusCode).toBe(400);
  });

  it("enforces unique design type slugs", async () => {
    expect((await createDesignType(context)).statusCode).toBe(201);
    const conflictResponse = await createDesignType(context, {
      name: "Another name",
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(conflictResponse.json()).error.code).toBe(
      "DESIGN_TYPE_SLUG_CONFLICT",
    );
  });

  it("normalizes sort order on create, move, and delete", async () => {
    const first = designTypeResponseSchema.parse(
      (await createDesignType(context)).json(),
    );
    const second = designTypeResponseSchema.parse(
      (
        await createDesignType(context, {
          name: "Second",
          slug: "second",
          sortOrder: 0,
        })
      ).json(),
    );
    const third = designTypeResponseSchema.parse(
      (
        await createDesignType(context, {
          name: "Third",
          slug: "third",
          sortOrder: 999,
        })
      ).json(),
    );

    const initial = designTypeListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/design-types",
        })
      ).json(),
    );
    expect(initial.map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      [second.id, 0],
      [first.id, 1],
      [third.id, 2],
    ]);

    const movedResponse = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/design-types/${third.id}`,
      payload: { sortOrder: 0 },
    });
    expect(movedResponse.statusCode).toBe(200);

    const deleteResponse = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/design-types/${second.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);

    const final = designTypeListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/design-types",
        })
      ).json(),
    );
    expect(final.map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      [third.id, 0],
      [first.id, 1],
    ]);
  });

  it("rolls back deletion when a future reference uses the design type", async () => {
    const created = designTypeResponseSchema.parse(
      (await createDesignType(context)).json(),
    );
    const sqlite = new BetterSqlite3(context.databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      sqlite.exec(`
        create table future_references (
          id text primary key not null,
          design_type_id text not null references design_types(id) on delete restrict
        )
      `);
      sqlite
        .prepare(
          "insert into future_references (id, design_type_id) values (?, ?)",
        )
        .run("future-reference", created.id);
    } finally {
      sqlite.close();
    }

    const deleteResponse = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/design-types/${created.id}`,
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe(
      "DESIGN_TYPE_IN_USE",
    );

    const detailResponse = await context.app.inject({
      method: "GET",
      url: `/api/v1/design-types/${created.slug}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(
      designTypeResponseSchema.parse(detailResponse.json()).vocabulary,
    ).toEqual(validDesignTypeInput.vocabulary);
  });

  it("validates identifiers, slugs, and non-empty patch bodies", async () => {
    const invalidSlug = await context.app.inject({
      method: "GET",
      url: "/api/v1/design-types/Invalid_Slug",
    });
    expect(invalidSlug.statusCode).toBe(400);

    const invalidId = await context.app.inject({
      method: "PATCH",
      url: "/api/v1/design-types/not-a-uuid",
      payload: { name: "Valid name" },
    });
    expect(invalidId.statusCode).toBe(400);

    const created = designTypeResponseSchema.parse(
      (await createDesignType(context)).json(),
    );
    const emptyPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/design-types/${created.id}`,
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);
  });
});
