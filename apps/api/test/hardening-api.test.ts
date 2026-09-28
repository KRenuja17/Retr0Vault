import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Writable } from "node:stream";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorResponseSchema, statsResponseSchema } from "@retr0vault/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createImageReferenceRecord, updateReference } from "../src/services/references.js";
import { createDesignType } from "../src/services/design-types.js";
import { createCollection } from "../src/services/collections.js";
import { createMultipartPayload, createTestApp, disposeTestApp, validDesignTypeInput, type TestAppContext, TEST_USER } from "./helpers.js";

describe("backend hardening and statistics", () => {
  let context: TestAppContext;
  beforeEach(async () => { context = await createTestApp("hardening-api"); });
  afterEach(async () => { await disposeTestApp(context); });

  it("reports empty totals and rejects unsupported filters", async () => {
    const result = await context.app.inject("/api/v1/stats");
    expect(result.statusCode).toBe(200);
    expect(statsResponseSchema.parse(result.json())).toEqual({ totalReferences: 0, pendingReferences: 0, analyzedReferences: 0,
      unassignedReferences: 0, countsByDesignType: [], countsByCollection: [],
      motionStudies: { total: 0, pending: 0, analyzed: 0, manual: 0, failed: 0 },
      countsByTrigger: ["load", "time", "scroll", "wheel", "cursor", "hover", "click", "pinned", "unknown"].map((trigger) => ({ trigger, count: 0 })) });
    expect((await context.app.inject("/api/v1/stats?status=pending")).statusCode).toBe(400);
  });

  it("counts all statuses, zero-count groups and overlapping collections live", async () => {
    const connection = context.db;
    const type = await createDesignType(connection, validDesignTypeInput);
    const empty = await createDesignType(connection, { ...validDesignTypeInput, name: "Empty", slug: "empty" });
    const first = await createCollection(connection, { name: "First", slug: "first", description: "", isPinned: false }, undefined, TEST_USER.id);
    const second = await createCollection(connection, { name: "Second", slug: "second", description: "", isPinned: false }, undefined, TEST_USER.id);
    const third = await createCollection(connection, { name: "Empty", slug: "empty", description: "", isPinned: false }, undefined, TEST_USER.id);
    const ids: string[] = [];
    for (const status of ["pending", "analyzed", "manual", "failed"] as const) {
      const id = randomUUID(); ids.push(id);
      await createImageReferenceRecord(connection, id, { title: status }, { originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`, width: 2, height: 2, format: "png" }, TEST_USER.id);
      await updateReference(connection, id, { analysisStatus: status, ...(status === "failed" ? {} : { designTypeId: type.id }),
        collectionIds: status === "pending" ? [first.id, second.id] : status === "analyzed" ? [first.id] : [] });
    }
    const result = statsResponseSchema.parse((await context.app.inject("/api/v1/stats")).json());
    expect(result).toMatchObject({ totalReferences: 4, pendingReferences: 1, analyzedReferences: 1, unassignedReferences: 1 });
    expect(result.countsByDesignType.map(({ id, referenceCount }) => ({ id, referenceCount }))).toEqual([
      { id: type.id, referenceCount: 3 }, { id: empty.id, referenceCount: 0 },
    ]);
    expect(result.countsByCollection.map(({ id, referenceCount }) => ({ id, referenceCount }))).toEqual([
      { id: first.id, referenceCount: 2 }, { id: second.id, referenceCount: 1 }, { id: third.id, referenceCount: 0 },
    ]);
    expect((await context.app.inject({ method: "DELETE", url: `/api/v1/references/${ids[0]}` })).statusCode).toBe(204);
    const after = statsResponseSchema.parse((await context.app.inject("/api/v1/stats")).json());
    expect(after).toMatchObject({ totalReferences: 3, pendingReferences: 0, analyzedReferences: 1 });
    expect(after.countsByCollection.map((group) => group.referenceCount)).toEqual([1, 0, 0]);
  });

  it.each(["http://127.0.0.1:4610", "http://localhost:4610", "http://127.0.0.1:4611"])("permits the exact local origin %s", async (origin) => {
    const result = await context.app.inject({ url: "/api/v1/stats", headers: { origin } });
    expect(result.statusCode).toBe(200);
    expect(result.headers["access-control-allow-origin"]).toBe(origin);
    expect(result.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["cache-control"]).toBe("no-store");
  });

  it("supports PATCH preflight and exposes export filenames", async () => {
    const result = await context.app.inject({ method: "OPTIONS", url: `/api/v1/references/${randomUUID()}`,
      headers: { origin: "http://localhost:4610", "access-control-request-method": "PATCH", "access-control-request-headers": "content-type" } });
    expect(result.statusCode).toBe(204);
    expect(result.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(result.headers["access-control-allow-headers"]).toBe("Content-Type");
    const get = await context.app.inject({ url: "/api/v1/stats", headers: { origin: "http://localhost:4610" } });
    expect(get.headers["access-control-expose-headers"]).toBe("Content-Disposition");
  });

  it.each(["https://evil.example", "null", "http://localhost:9999", "http://localhost:4610.evil.example", "http://127.0.0.1:4610/"])("blocks cross-origin writes from %s", async (origin) => {
    const result = await context.app.inject({ method: "POST", url: "/api/v1/design-types", headers: { origin }, payload: validDesignTypeInput });
    expect(result.statusCode).toBe(403);
    expect(errorResponseSchema.parse(result.json()).error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect((await context.app.inject("/api/v1/design-types")).json()).toEqual([]);
    expect(result.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each(["evil.example", "127.0.0.1.evil.example", "localhost:65536", "localhost@evil.example", "0.0.0.0"])("blocks a DNS-rebinding Host %s", async (host) => {
    const result = await context.app.inject({ url: "/api/v1/health", headers: { host } });
    expect(result.statusCode).toBe(403);
  });

  it("rejects cross-site browser requests even without Origin and allows local CLI requests", async () => {
    expect((await context.app.inject({ url: "/api/v1/stats", headers: { "sec-fetch-site": "cross-site" } })).statusCode).toBe(403);
    expect((await context.app.inject("/api/v1/stats")).statusCode).toBe(200);
    expect(() => loadConfig({ HOST: "192.168.1.10" })).toThrow(/Invalid environment/);
  });

  it("does not leak SQL, paths, URLs or secrets through errors or logs", async () => {
    const chunks: string[] = [];
    const stream = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
    const app = await buildApp({ connection: context.connection, storageRoot: join(context.directory, "log-storage"), logger: { stream } });
    app.get("/failure", async () => { throw new Error("private SQL VALUES ('secret-token') D:\\private\\vault.db"); });
    app.get("/invalid-status", async () => { throw Object.assign(new Error("secret-token"), { statusCode: 999 }); });
    try {
      for (const url of ["/failure?password=secret-token", "/invalid-status", "/secret-token?token=secret-token"]) {
        const response = await app.inject({ url, headers: { authorization: "secret-token" } });
        expect([404, 500]).toContain(response.statusCode);
        errorResponseSchema.parse(response.json());
        expect(response.body).not.toMatch(/secret-token|private|VALUES/u);
      }
      expect(chunks.join("")).not.toMatch(/secret-token|private|VALUES/u);
    } finally { await app.close(); }
  });

  it("maps database contention and an unreachable database to bounded, retryable responses", async () => {
    const app = await buildApp({ connection: context.connection, storageRoot: join(context.directory, "busy-storage"), logger: false });
    // Shaped as Drizzle wraps driver errors: the SQLSTATE or network code sits on the cause.
    const failure = (code: string) => Object.assign(new Error("Failed query: insert into secret"), { cause: Object.assign(new Error("driver"), { code }) });
    app.get("/deadlock", async () => { throw failure("40P01"); });
    app.get("/serialization", async () => { throw failure("40001"); });
    app.get("/refused", async () => { throw failure("ECONNREFUSED"); });
    try {
      for (const url of ["/deadlock", "/serialization"]) {
        const response = await app.inject(url);
        expect(response.statusCode, response.body).toBe(503);
        expect(response.headers["retry-after"]).toBe("1");
        expect(response.json().error.code).toBe("DATABASE_BUSY");
      }
      const refused = await app.inject("/refused");
      expect(refused.statusCode).toBe(503);
      expect(refused.headers["retry-after"]).toBe("10");
      expect(refused.json().error.code).toBe("DATABASE_UNAVAILABLE");
      expect(refused.body).not.toMatch(/secret/u);
    } finally { await app.close(); }
  });

  it.each(["javascript:alert(1)", "file:///C:/secret", "https://user:password@example.com/", "https://example.com/" + "a".repeat(2_049)])("rejects unsafe metadata URLs", async (sourceUrl) => {
    const response = await context.app.inject({ method: "PATCH", url: `/api/v1/references/${randomUUID()}`, payload: { sourceUrl } });
    expect(response.statusCode).toBe(400);
  });

  it("bounds JSON bodies, nesting, values and duplicate protected fields", async () => {
    let nested: unknown = "leaf";
    for (let index = 0; index < 25; index++) nested = { child: nested };
    for (const payload of [{ analysisJson: nested }, { analysisJson: { values: Array.from({ length: 10_001 }, () => 0) } }, { protectedFields: ["title", "title"] }]) {
      expect((await context.app.inject({ method: "PATCH", url: `/api/v1/references/${randomUUID()}`, payload })).statusCode).toBe(400);
    }
    const huge = await context.app.inject({ method: "PATCH", url: `/api/v1/references/${randomUUID()}`, payload: { designBrief: "x".repeat(1_048_576) } });
    expect(huge.statusCode).toBe(413);
  });

  it("rejects truncated multipart fields and fully decodes uploaded images before writing", async () => {
    const original = await sharp({ create: { width: 100, height: 100, channels: 3, background: "red" } }).jpeg().toBuffer();
    for (const [fields, buffer] of [[{ title: "x".repeat(9_000) }, original], [{}, original.subarray(0, original.length - 40)]] as const) {
      const multipart = createMultipartPayload({ fields, file: { buffer } });
      const result = await context.app.inject({ method: "POST", url: "/api/v1/references/image", ...multipart });
      expect([400, 413]).toContain(result.statusCode);
    }
    expect(existsSync(join(context.storageRoot, "originals"))).toBe(false);
  });
});
