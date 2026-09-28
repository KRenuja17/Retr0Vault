import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { referenceResponseSchema, sessionResponseSchema, showcaseResponseSchema } from "@retr0vault/shared";

import { buildApp } from "../src/app.js";
import { verifyPassword } from "../src/auth/passwords.js";
import { LoginThrottle } from "../src/auth/throttle.js";
import type { DatabaseConnection } from "../src/database/connection.js";
import { adoptUnowned, createUser, setPassword } from "../src/services/users.js";
import { createImageReferenceRecord } from "../src/services/references.js";
import { createMultipartPayload, createTestDatabase, queryRows } from "./helpers.js";

describe("signing in to the vault", () => {
  let directory: string;
  let connection: DatabaseConnection;
  let app: FastifyInstance;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-auth-"));
    connection = await createTestDatabase();
    // No test account: every request is exactly as a browser's would be.
    app = await buildApp({ connection, storageRoot: join(directory, "storage"), logger: false, motionQueueStart: "ready" });
    await createUser(connection.database, "Krenuja", "correct horse");
    await createUser(connection.database, "Visitor", "another secret");
  });

  afterEach(async () => {
    await app.close();
    await connection.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  const login = (username: string, password: string) =>
    app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password } });

  async function sessionCookie(username: string, password: string): Promise<string> {
    const response = await login(username, password);
    expect(response.statusCode, response.body).toBe(200);
    return String(response.headers["set-cookie"]).split(";")[0]!;
  }

  it("keeps the vault shut without a session, but leaves the front door's own routes open", async () => {
    for (const url of ["/api/v1/references", "/api/v1/stats", "/api/v1/collections", "/api/v1/motion", "/api/v1/auth/session", "/api/v1/nowhere"]) {
      const response = await app.inject(url);
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code).toBe("AUTH_REQUIRED");
    }
    expect((await app.inject("/api/v1/health")).statusCode).toBe(200);
    expect(showcaseResponseSchema.parse((await app.inject("/api/v1/showcase")).json()).counts.plates).toBe(0);
    // A forged or stale cookie is no session.
    const forged = await app.inject({ url: "/api/v1/references", headers: { cookie: `rv_session=${"A".repeat(43)}` } });
    expect(forged.statusCode).toBe(401);
  });

  it("signs in with a matching username (any case) and password, in an HttpOnly, SameSite=Strict cookie", async () => {
    const response = await login("KRENUJA", "correct horse");
    expect(response.statusCode, response.body).toBe(200);
    expect(sessionResponseSchema.parse(response.json()).user.username).toBe("Krenuja");
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/^rv_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/u);

    const session = cookie.split(";")[0]!;
    expect((await app.inject({ url: "/api/v1/auth/session", headers: { cookie: session } })).json().user.username).toBe("Krenuja");
    expect((await app.inject({ url: "/api/v1/references", headers: { cookie: session } })).statusCode).toBe(200);

    // Only a hash of the token is stored, and only a hash of the password.
    const [row] = await queryRows<{ token_hash: string }>(connection.database, sql`select token_hash from sessions`);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(session).not.toContain(row!.token_hash);
    const [user] = await queryRows<{ password_hash: string }>(connection.database, sql`select password_hash from users where username = 'Krenuja'`);
    expect(user!.password_hash).toMatch(/^scrypt\$/u);
    expect(await verifyPassword("correct horse", user!.password_hash)).toBe(true);
  });

  it("answers a wrong password and an unknown name alike, and pauses after five failures", async () => {
    const wrong = await login("Krenuja", "wrong");
    const unknown = await login("Nobody", "wrong");
    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    for (let attempt = 0; attempt < 4; attempt += 1) await login("Krenuja", "still wrong");
    const paused = await login("Krenuja", "correct horse");
    expect(paused.statusCode).toBe(429);
    expect(paused.json().error.code).toBe("AUTH_THROTTLED");
    expect(Number(paused.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("signs out, ending the session", async () => {
    const session = await sessionCookie("Krenuja", "correct horse");
    const out = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: session } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await app.inject({ url: "/api/v1/references", headers: { cookie: session } })).statusCode).toBe(401);
  });

  it("ends every session of an account when its password changes", async () => {
    const session = await sessionCookie("Krenuja", "correct horse");
    const [user] = await queryRows<{ id: string }>(connection.database, sql`select id from users where username = 'Krenuja'`);
    await setPassword(connection.database, user!.id, "a new combination");
    expect((await app.inject({ url: "/api/v1/references", headers: { cookie: session } })).statusCode).toBe(401);
    expect((await login("Krenuja", "a new combination")).statusCode).toBe(200);
  });

  it("shows each account only its own references, while the front door shows everyone's newest", async () => {
    const mine = await sessionCookie("Krenuja", "correct horse");
    const theirs = await sessionCookie("Visitor", "another secret");
    const image = await sharp({ create: { width: 8, height: 6, channels: 3, background: "red" } }).png().toBuffer();
    const multipart = createMultipartPayload({ fields: { title: "Mine" }, file: { buffer: image } });
    const created = await app.inject({
      method: "POST", url: "/api/v1/references/image",
      headers: { ...multipart.headers, cookie: mine }, payload: multipart.payload,
    });
    expect(created.statusCode, created.body).toBe(201);
    const reference = referenceResponseSchema.parse(created.json());

    const as = (cookie: string, url: string) => app.inject({ url, headers: { cookie } });
    expect((await as(mine, "/api/v1/references")).json().total).toBe(1);
    expect((await as(theirs, "/api/v1/references")).json().total).toBe(0);
    for (const url of [`/api/v1/references/${reference.id}`, `/api/v1/media/${reference.id}/original`, `/api/v1/references/${reference.id}/motion`]) {
      const response = await as(theirs, url);
      expect(response.statusCode, url).toBe(404);
    }
    const hijack = await app.inject({ method: "PATCH", url: `/api/v1/references/${reference.id}`, headers: { cookie: theirs }, payload: { title: "Taken" } });
    expect(hijack.statusCode).toBe(404);
    expect((await as(theirs, "/api/v1/stats")).json().totalReferences).toBe(0);
    expect((await as(mine, "/api/v1/stats")).json().totalReferences).toBe(1);

    // The front door, signed in or not.
    const showcase = showcaseResponseSchema.parse((await app.inject("/api/v1/showcase")).json());
    expect(showcase.references.map((item) => item.id)).toEqual([reference.id]);
    expect(showcase.counts.plates).toBe(1);
    const thumbnail = await app.inject(`/api/v1/showcase/${reference.id}/thumbnail`);
    expect(thumbnail.statusCode).toBe(200);
    expect(thumbnail.headers["content-type"]).toBe("image/webp");
    // Only the thumbnail is public.
    expect((await app.inject(`/api/v1/media/${reference.id}/original`)).statusCode).toBe(401);
  });

  it("gives an account the archive's unowned references and collections", async () => {
    const id = "aaaaaaaa-0000-4000-8000-00000000abcd";
    await createImageReferenceRecord(connection.database, id, { title: "Legacy" },
      { originalPath: `originals/${id}.png`, thumbnailPath: `thumbnails/${id}.webp`, width: 2, height: 2, format: "png" });
    const session = await sessionCookie("Krenuja", "correct horse");
    expect((await app.inject({ url: "/api/v1/references", headers: { cookie: session } })).json().total).toBe(0);
    const [user] = await queryRows<{ id: string }>(connection.database, sql`select id from users where username = 'Krenuja'`);
    expect(await adoptUnowned(connection.database, user!.id)).toEqual({ references: 1, collections: 0 });
    expect((await app.inject({ url: "/api/v1/references", headers: { cookie: session } })).json().total).toBe(1);
  });

  it("refuses unusable usernames, short passwords and a taken name", async () => {
    await expect(createUser(connection.database, "no spaces allowed", "long enough")).rejects.toMatchObject({ code: "INVALID_USERNAME" });
    await expect(createUser(connection.database, "Short", "12345")).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
    await expect(createUser(connection.database, "krenuja", "long enough")).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
  });
});

describe("the sign-in throttle", () => {
  it("allows five failures, then pauses for longer after each further one, and forgets a success", () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    const keys = ["name:krenuja"];
    for (let failure = 1; failure <= 4; failure += 1) expect(throttle.fail(keys)).toBe(5 - failure);
    expect(throttle.retryAfter(keys)).toBe(0);
    expect(throttle.fail(keys)).toBe(0);
    expect(throttle.retryAfter(keys)).toBe(30);
    now += 30_000;
    throttle.fail(keys);
    expect(throttle.retryAfter(keys)).toBe(60);
    throttle.succeed(keys);
    expect(throttle.retryAfter(keys)).toBe(0);
  });
});
