import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt } from "drizzle-orm";

import type { Db } from "../database/connection.js";
import { sessions, users } from "../database/schema.js";

/*
 * A signed-in browser holds a random token in an HttpOnly cookie; the database
 * holds only its SHA-256, so a leaked sessions table opens nothing. Sessions
 * last two weeks from their last use.
 */

export const SESSION_COOKIE = "rv_session";
export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1_000;
/** A session's expiry is pushed back at most this often, to spare a write per request. */
const RENEW_AFTER_MS = 60 * 60 * 1_000;

export interface SessionUser {
  readonly id: string;
  readonly username: string;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now + SESSION_LIFETIME_MS),
  });
  // Expired sessions are cleared as new ones are made.
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now)));
  return token;
}

/** The account a token signs in, if the session is live; renews it when due. */
export async function findSessionUser(db: Db, token: string | undefined): Promise<SessionUser | undefined> {
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return undefined;
  const tokenHash = hashToken(token);
  const now = new Date();
  const [row] = await db.select({
    id: users.id, username: users.username, lastSeenAt: sessions.lastSeenAt,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  if (row === undefined) return undefined;
  if (now.getTime() - row.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    await db.update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS) })
      .where(eq(sessions.tokenHash, tokenHash));
  }
  return { id: row.id, username: row.username };
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * The session cookie: HttpOnly (no script can read it), SameSite=Strict (no
 * other site can send it), for the whole app. `Secure` in production; the
 * local API is plain HTTP on loopback.
 */
export function sessionCookie(token: string | null, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${token === null ? "" : token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    token === null ? "Max-Age=0" : `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1_000)}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}
