import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  errorResponseSchema,
  healthResponseSchema,
} from "@retr0vault/shared";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { defaultMigrationsFolder, openPglite, type DatabaseConnection } from "../src/database/connection.js";
import { createTestDatabase, queryRows } from "./helpers.js";

describe("B1 backend foundation", () => {
  let temporaryDirectory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "retr0vault-b1-"));
    connection = await createTestDatabase();
  });

  afterEach(async () => {
    await connection.close();
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  function build() {
    return buildApp({
      connection,
      storageRoot: join(temporaryDirectory, "storage"),
      logger: false,
    });
  }

  it("starts the API on a local ephemeral port", async () => {
    const app = await build();

    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(app.server.listening).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("returns the expected health structure", async () => {
    const app = await build();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/health",
      });

      expect(response.statusCode).toBe(200);
      const body = healthResponseSchema.parse(response.json());
      expect(body).toMatchObject({
        status: "ok",
        service: "retr0vault-api",
        version: "0.1.0",
        database: "ready",
      });
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("migrates an empty database on startup and leaves the connection to its owner", async () => {
    const empty = await openPglite();
    try {
      const app = await buildApp({
        connection: empty,
        storageRoot: join(temporaryDirectory, "storage"),
        logger: false,
      });
      await app.close();

      expect(
        await queryRows(empty.database, sql`select to_regclass('public.app_metadata')::text as name`),
      ).toEqual([{ name: "app_metadata" }]);
    } finally {
      await empty.close();
    }
  });

  it("refuses to start without DATABASE_URL", async () => {
    await expect(
      buildApp({ config: loadConfig({}), logger: false }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it("applies committed migrations to a clean database idempotently", async () => {
    const clean = await openPglite();

    try {
      await clean.migrate();
      await clean.migrate();

      const journal = JSON.parse(
        readFileSync(join(defaultMigrationsFolder, "meta", "_journal.json"), "utf8"),
      ) as { entries: unknown[] };
      expect(
        await queryRows(clean.database, sql`select count(*)::int as applied from drizzle.__drizzle_migrations`),
      ).toEqual([{ applied: journal.entries.length }]);
      const coreTables = await queryRows<{ name: string }>(clean.database, sql`
        select table_name as name from information_schema.tables
        where table_schema = 'public' and table_name in ('app_metadata', 'design_types', 'design_type_rules',
          'design_type_vocabulary', 'collections', 'references', 'tags', 'reference_tags', 'collection_references')
        order by table_name`);
      expect(coreTables.map(({ name }) => name)).toEqual([
        "app_metadata",
        "collection_references",
        "collections",
        "design_type_rules",
        "design_type_vocabulary",
        "design_types",
        "reference_tags",
        "references",
        "tags",
      ]);
    } finally {
      await clean.close();
    }
  });

  it("returns a structured response for an invalid route", async () => {
    const app = await build();

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/does-not-exist",
      });

      expect(response.statusCode).toBe(404);
      const body = errorResponseSchema.parse(response.json());
      expect(body.error).toEqual({
        code: "ROUTE_NOT_FOUND",
        message: "The requested route was not found",
        statusCode: 404,
      });
      expect(body.requestId).not.toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid environment values before startup", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        HOST: "0.0.0.0",
        PORT: "not-a-port",
      }),
    ).toThrowError(/Invalid environment configuration/);
  });

  it("takes the bucket settings all together or not at all", () => {
    const bucket = {
      S3_ENDPOINT: "https://s3.us-east-005.backblazeb2.com", S3_REGION: "us-east-005", S3_BUCKET: "vault",
      S3_ACCESS_KEY_ID: "key-id", S3_SECRET_ACCESS_KEY: "secret",
    };
    expect(loadConfig(bucket).objectStorage).toEqual({
      endpoint: bucket.S3_ENDPOINT, region: "us-east-005", bucket: "vault", accessKeyId: "key-id", secretAccessKey: "secret",
    });
    // Blank values, as in a copied .env.example, count as not set.
    expect(loadConfig({ DATABASE_URL: "", ...Object.fromEntries(Object.keys(bucket).map((name) => [name, ""])) }))
      .toMatchObject({ databaseUrl: undefined, objectStorage: undefined });
    expect(() => loadConfig({ ...bucket, S3_SECRET_ACCESS_KEY: "" })).toThrowError(/also needs S3_SECRET_ACCESS_KEY/);
    expect(() => loadConfig({ ...bucket, S3_ENDPOINT: "http://s3.example.com" })).toThrowError(/Invalid environment configuration/);
  });
});
