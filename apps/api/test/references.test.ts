import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectionResponseSchema,
  designTypeResponseSchema,
  errorResponseSchema,
  referenceListResponseSchema,
  referenceResponseSchema,
  type ImageFormat,
} from "@retr0vault/shared";

import {
  createMultipartPayload,
  createTestApp,
  disposeTestApp,
  type TestAppContext,
  validDesignTypeInput,
} from "./helpers.js";

async function createImage(
  format: ImageFormat,
  width = 96,
  height = 64,
): Promise<Buffer> {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 190, g: 80, b: 45, alpha: 1 },
    },
  });

  return format === "jpeg"
    ? pipeline.jpeg({ quality: 90 }).toBuffer()
    : format === "webp"
      ? pipeline.webp({ quality: 90 }).toBuffer()
      : pipeline.png().toBuffer();
}

async function uploadImage(
  context: TestAppContext,
  buffer: Buffer,
  fields: Record<string, string> = {},
  options: {
    readonly filename?: string;
    readonly fieldname?: string;
    readonly contentType?: string;
  } = {},
) {
  const multipart = createMultipartPayload({
    fields,
    file: {
      buffer,
      ...(options.filename === undefined ? {} : { filename: options.filename }),
      ...(options.fieldname === undefined
        ? {}
        : { fieldname: options.fieldname }),
      ...(options.contentType === undefined
        ? {}
        : { contentType: options.contentType }),
    },
  });
  return context.app.inject({
    method: "POST",
    url: "/api/v1/references/image",
    headers: multipart.headers,
    payload: multipart.payload,
  });
}

async function createDesignType(context: TestAppContext) {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/v1/design-types",
    payload: validDesignTypeInput,
  });
  expect(response.statusCode).toBe(201);
  return designTypeResponseSchema.parse(response.json());
}

async function createCollection(context: TestAppContext, slug = "keepers") {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/v1/collections",
    payload: {
      name: slug === "keepers" ? "Keepers" : slug,
      slug,
      description: "Reference collection.",
      isPinned: false,
    },
  });
  expect(response.statusCode).toBe(201);
  return collectionResponseSchema.parse(response.json());
}

describe("reference image ingestion and CRUD", () => {
  let context: TestAppContext;

  beforeEach(async () => {
    context = await createTestApp("references");
  });

  afterEach(async () => {
    await disposeTestApp(context);
  });

  it("verifies, preserves, and thumbnails an image without trusting its filename", async () => {
    const designType = await createDesignType(context);
    const original = await createImage("png", 120, 80);
    const response = await uploadImage(
      context,
      original,
      {
        title: "  Material Study  ",
        sourceUrl: "https://example.com/reference",
        designTypeId: designType.id,
      },
      {
        filename: "../../outside/not-really-a-jpeg.jpg",
        contentType: "image/jpeg",
      },
    );

    expect(response.statusCode, response.body).toBe(201);
    const reference = referenceResponseSchema.parse(response.json());
    expect(reference).toMatchObject({
      title: "Material Study",
      sourceType: "image",
      sourceUrl: "https://example.com/reference",
      designTypeId: designType.id,
      analysisStatus: "pending",
      image: { width: 120, height: 80, format: "png" },
      tags: [],
      collectionIds: [],
    });
    expect(reference.originalPath).toBe(`originals/${reference.id}.png`);
    expect(reference.thumbnailPath).toBe(`thumbnails/${reference.id}.webp`);

    const originalPath = join(context.storageRoot, reference.originalPath);
    const thumbnailPath = join(context.storageRoot, reference.thumbnailPath);
    expect(readFileSync(originalPath).equals(original)).toBe(true);
    expect(existsSync(thumbnailPath)).toBe(true);
    expect(existsSync(join(context.directory, "outside"))).toBe(false);

    const thumbnailMetadata = await sharp(
      readFileSync(thumbnailPath),
    ).metadata();
    expect(thumbnailMetadata.format).toBe("webp");
    expect(thumbnailMetadata.width).toBeLessThanOrEqual(120);
    expect(thumbnailMetadata.height).toBeLessThanOrEqual(80);

    const designTypeResponse = await context.app.inject({
      method: "GET",
      url: `/api/v1/design-types/${designType.slug}`,
    });
    expect(
      designTypeResponseSchema.parse(designTypeResponse.json()).referenceCount,
    ).toBe(1);
  });

  it.each(["jpeg", "webp"] as const)(
    "accepts actual %s image content",
    async (format) => {
      const response = await uploadImage(
        context,
        await createImage(format),
        { title: `${format} reference` },
        { filename: "misleading.png", contentType: "image/png" },
      );
      expect(response.statusCode, response.body).toBe(201);
      const reference = referenceResponseSchema.parse(response.json());
      expect(reference.image.format).toBe(format);
      expect(reference.originalPath).toMatch(
        format === "jpeg" ? /\.jpg$/u : /\.webp$/u,
      );
    },
  );

  it("rejects invalid, unsupported, missing, and malformed uploads", async () => {
    const invalid = await uploadImage(context, Buffer.from("not an image"));
    expect(invalid.statusCode).toBe(400);
    expect(errorResponseSchema.parse(invalid.json()).error.code).toBe(
      "INVALID_IMAGE",
    );

    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "base64",
    );
    const unsupported = await uploadImage(context, gif, {}, {
      filename: "pixel.gif",
      contentType: "image/gif",
    });
    expect(unsupported.statusCode).toBe(415);
    expect(errorResponseSchema.parse(unsupported.json()).error.code).toBe(
      "UNSUPPORTED_IMAGE_FORMAT",
    );

    const wrongField = await uploadImage(
      context,
      await createImage("png"),
      {},
      { fieldname: "attachment" },
    );
    expect(wrongField.statusCode).toBe(400);

    const missingFileMultipart = createMultipartPayload({
      fields: { title: "No image" },
    });
    const missingFile = await context.app.inject({
      method: "POST",
      url: "/api/v1/references/image",
      headers: missingFileMultipart.headers,
      payload: missingFileMultipart.payload,
    });
    expect(missingFile.statusCode).toBe(400);

    const nonMultipart = await context.app.inject({
      method: "POST",
      url: "/api/v1/references/image",
      payload: { title: "No multipart" },
    });
    expect(nonMultipart.statusCode).toBe(415);

    expect(existsSync(join(context.storageRoot, "originals"))).toBe(false);
  });

  it("enforces the configured upload limit", async () => {
    await disposeTestApp(context);
    context = await createTestApp("upload-limit", { maxUploadBytes: 100 });
    const response = await uploadImage(context, Buffer.alloc(512, 1));
    expect(response.statusCode).toBe(413);
  });

  it("rolls back stored files when reference creation is rejected", async () => {
    const response = await uploadImage(
      context,
      await createImage("png"),
      { designTypeId: randomUUID() },
    );

    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe(
      "DESIGN_TYPE_NOT_FOUND",
    );
    expect(readdirSync(join(context.storageRoot, "originals"))).toEqual([]);
    expect(readdirSync(join(context.storageRoot, "thumbnails"))).toEqual([]);
  });

  it("updates metadata, tags, and collection membership transactionally", async () => {
    const collection = await createCollection(context);
    const reference = referenceResponseSchema.parse(
      (
        await uploadImage(context, await createImage("png"), {
          title: "Mutable Reference",
        })
      ).json(),
    );

    const updateResponse = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/references/${reference.id}`,
      payload: {
        title: "Curated Reference",
        sourceUrl: "https://example.com/curated",
        designDNA: "editorial × material",
        designThesis: "Material texture supports editorial hierarchy.",
        designBrief: "Use material texture with restraint.",
        imageRecipe: "[SUBJECT] on a warm paper ground",
        analysisStatus: "manual",
        analysisJson: { palette: ["warm paper", "black"] },
        tags: [
          { type: "Imagery", value: " Film   Grain " },
          { type: "Typography", value: "Large Serif" },
        ],
        collectionIds: [collection.id],
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    const updated = referenceResponseSchema.parse(updateResponse.json());
    expect(updated).toMatchObject({
      title: "Curated Reference",
      sourceUrl: "https://example.com/curated",
      designDNA: "editorial × material",
      analysisStatus: "manual",
      analysisJson: { palette: ["warm paper", "black"] },
      collectionIds: [collection.id],
    });
    expect(updated.tags).toMatchObject([
      {
        type: "imagery",
        value: "Film   Grain",
        normalizedValue: "film grain",
        sortOrder: 0,
      },
      {
        type: "typography",
        value: "Large Serif",
        normalizedValue: "large serif",
        sortOrder: 1,
      },
    ]);

    const detail = await context.app.inject({
      method: "GET",
      url: `/api/v1/references/${reference.id}`,
    });
    expect(referenceResponseSchema.parse(detail.json())).toEqual(updated);

    const collectionResponse = await context.app.inject({
      method: "GET",
      url: "/api/v1/collections",
    });
    expect(
      collectionResponseSchema.parse(collectionResponse.json()[0]).referenceCount,
    ).toBe(1);

    const duplicateTags = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/references/${reference.id}`,
      payload: {
        tags: [
          { type: "imagery", value: "Film Grain" },
          { type: "IMAGERY", value: " film   grain " },
        ],
      },
    });
    expect(duplicateTags.statusCode).toBe(400);

    const clearTags = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/references/${reference.id}`,
      payload: { tags: [] },
    });
    expect(clearTags.statusCode).toBe(200);
    expect(referenceResponseSchema.parse(clearTags.json()).tags).toEqual([]);

    const sqlite = new BetterSqlite3(context.databasePath, { readonly: true });
    try {
      const tagCount = sqlite.prepare("select count(*) as value from tags").get() as {
        value: number;
      };
      expect(tagCount.value).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("paginates and filters by design type, collection, status, and sort", async () => {
    const designType = await createDesignType(context);
    const collection = await createCollection(context);
    const alpha = referenceResponseSchema.parse(
      (
        await uploadImage(context, await createImage("png"), {
          title: "Alpha",
          designTypeId: designType.id,
        })
      ).json(),
    );
    const bravo = referenceResponseSchema.parse(
      (
        await uploadImage(context, await createImage("png"), {
          title: "Bravo",
          designTypeId: designType.id,
        })
      ).json(),
    );
    await uploadImage(context, await createImage("png"), { title: "Charlie" });

    await context.app.inject({
      method: "PATCH",
      url: `/api/v1/references/${alpha.id}`,
      payload: {
        analysisStatus: "manual",
        collectionIds: [collection.id],
      },
    });
    await context.app.inject({
      method: "PATCH",
      url: `/api/v1/references/${bravo.id}`,
      payload: { collectionIds: [collection.id] },
    });

    const page = referenceListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/references?sort=title-asc&page=2&limit=1",
        })
      ).json(),
    );
    expect(page).toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3 });
    expect(page.items[0]?.title).toBe("Bravo");

    const byDesignType = referenceListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/v1/references?designType=${designType.slug}&sort=title-asc`,
        })
      ).json(),
    );
    expect(byDesignType.items.map(({ title }) => title)).toEqual([
      "Alpha",
      "Bravo",
    ]);

    const byCollection = referenceListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/v1/references?collection=${collection.slug}`,
        })
      ).json(),
    );
    expect(byCollection.total).toBe(2);

    const byStatus = referenceListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/references?status=manual",
        })
      ).json(),
    );
    expect(byStatus.items.map(({ id }) => id)).toEqual([alpha.id]);

    const missingFilter = referenceListResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: "/api/v1/references?designType=does-not-exist",
        })
      ).json(),
    );
    expect(missingFilter.total).toBe(0);

    const invalidQuery = await context.app.inject({
      method: "GET",
      url: "/api/v1/references?limit=0",
    });
    expect(invalidQuery.statusCode).toBe(400);
  });

  it("supports ordered collection membership endpoints", async () => {
    const collection = await createCollection(context);
    const first = referenceResponseSchema.parse(
      (await uploadImage(context, await createImage("png"), { title: "First" })).json(),
    );
    const second = referenceResponseSchema.parse(
      (await uploadImage(context, await createImage("png"), { title: "Second" })).json(),
    );

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: `/api/v1/collections/${collection.id}/references/${first.id}`,
          payload: {},
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: `/api/v1/collections/${collection.id}/references/${second.id}`,
          payload: { sortOrder: 0 },
        })
      ).statusCode,
    ).toBe(204);

    const sqlite = new BetterSqlite3(context.databasePath, { readonly: true });
    try {
      const rows = sqlite
        .prepare(
          "select reference_id as id, sort_order as sortOrder from collection_references where collection_id = ? order by sort_order",
        )
        .all(collection.id) as Array<{ id: string; sortOrder: number }>;
      expect(rows).toEqual([
        { id: second.id, sortOrder: 0 },
        { id: first.id, sortOrder: 1 },
      ]);
    } finally {
      sqlite.close();
    }

    const removeResponse = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/collections/${collection.id}/references/${second.id}`,
    });
    expect(removeResponse.statusCode).toBe(204);
    const detail = referenceResponseSchema.parse(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/v1/references/${second.id}`,
        })
      ).json(),
    );
    expect(detail.collectionIds).toEqual([]);
  });

  it("deletes database relations before removing only managed files", async () => {
    const collection = await createCollection(context);
    const reference = referenceResponseSchema.parse(
      (
        await uploadImage(context, await createImage("png"), {
          title: "Delete Me",
        })
      ).json(),
    );
    await context.app.inject({
      method: "PATCH",
      url: `/api/v1/references/${reference.id}`,
      payload: {
        tags: [{ type: "texture", value: "grain" }],
        collectionIds: [collection.id],
      },
    });
    const originalPath = join(context.storageRoot, reference.originalPath);
    const thumbnailPath = join(context.storageRoot, reference.thumbnailPath);

    const deleteResponse = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/references/${reference.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(thumbnailPath)).toBe(false);
    expect(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/v1/references/${reference.id}`,
        })
      ).statusCode,
    ).toBe(404);

    const collectionList = await context.app.inject({
      method: "GET",
      url: "/api/v1/collections",
    });
    expect(
      collectionResponseSchema.parse(collectionList.json()[0]).referenceCount,
    ).toBe(0);
  });

  it("keeps image files when database deletion is rejected", async () => {
    const reference = referenceResponseSchema.parse(
      (await uploadImage(context, await createImage("png"))).json(),
    );
    const originalPath = join(context.storageRoot, reference.originalPath);
    const thumbnailPath = join(context.storageRoot, reference.thumbnailPath);
    const sqlite = new BetterSqlite3(context.databasePath);
    try {
      sqlite.pragma("foreign_keys = ON");
      sqlite.exec(`
        create table future_protected_reference (
          id text primary key not null,
          reference_id text not null references "references"(id) on delete restrict
        )
      `);
      sqlite
        .prepare(
          "insert into future_protected_reference (id, reference_id) values (?, ?)",
        )
        .run("protected", reference.id);
    } finally {
      sqlite.close();
    }

    const deleteResponse = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/references/${reference.id}`,
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe(
      "REFERENCE_IN_USE",
    );
    expect(existsSync(originalPath)).toBe(true);
    expect(existsSync(thumbnailPath)).toBe(true);
  });

  it("never deletes an unrelated file referenced by a corrupted database path", async () => {
    const reference = referenceResponseSchema.parse(
      (await uploadImage(context, await createImage("png"))).json(),
    );
    const unrelatedDirectory = join(context.storageRoot, "originals");
    const unrelatedPath = join(unrelatedDirectory, "unrelated.png");
    mkdirSync(unrelatedDirectory, { recursive: true });
    writeFileSync(unrelatedPath, "must survive");

    const sqlite = new BetterSqlite3(context.databasePath);
    try {
      sqlite
        .prepare('update "references" set original_path = ? where id = ?')
        .run("originals/unrelated.png", reference.id);
    } finally {
      sqlite.close();
    }

    const deleteResponse = await context.app.inject({
      method: "DELETE",
      url: `/api/v1/references/${reference.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(readFileSync(unrelatedPath, "utf8")).toBe("must survive");
  });
});
