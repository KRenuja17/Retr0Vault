import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  errorResponseSchema,
  healthResponseSchema,
} from "@retr0vault/shared";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseConnection } from "../src/database/connection.js";
import { applyMigrations } from "../src/database/migrate.js";

describe("B1 backend foundation", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "retr0vault-b1-"));
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  it("starts the API on a local ephemeral port", async () => {
    const app = await buildApp({
      databasePath: join(temporaryDirectory, "starts.db"),
      logger: false,
    });

    try {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(app.server.listening).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("returns the expected health structure", async () => {
    const app = await buildApp({
      databasePath: join(temporaryDirectory, "health.db"),
      logger: false,
    });

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

  it("initializes the configured SQLite database", async () => {
    const databasePath = join(temporaryDirectory, "initializes.db");
    const app = await buildApp({ databasePath, logger: false });

    await app.ready();
    await app.close();

    expect(existsSync(databasePath)).toBe(true);

    const sqlite = new BetterSqlite3(databasePath, { readonly: true });
    try {
      const table = sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'app_metadata'",
        )
        .get() as { name: string } | undefined;
      expect(table?.name).toBe("app_metadata");
    } finally {
      sqlite.close();
    }
  });

  it("applies committed migrations to a clean database idempotently", () => {
    const connection = createDatabaseConnection(
      join(temporaryDirectory, "migrations.db"),
    );

    try {
      applyMigrations(connection);
      applyMigrations(connection);

      const applicationTable = connection.sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = 'app_metadata'",
        )
        .get() as { name: string } | undefined;
      const migrationTable = connection.sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
        )
        .get() as { name: string } | undefined;

      expect(applicationTable?.name).toBe("app_metadata");
      expect(migrationTable?.name).toBe("__drizzle_migrations");

      const coreTables = connection.sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name in ('design_types', 'design_type_rules', 'design_type_vocabulary', 'collections', 'references', 'tags', 'reference_tags', 'collection_references') order by name",
        )
        .all() as Array<{ name: string }>;
      expect(coreTables.map(({ name }) => name)).toEqual([
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
      connection.sqlite.close();
    }
  });

  it("returns a structured response for an invalid route", async () => {
    const app = await buildApp({
      databasePath: join(temporaryDirectory, "not-found.db"),
      logger: false,
    });

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
});
