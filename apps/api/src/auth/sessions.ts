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
/**
 * A live session, once read, is trusted for this long without asking the
 * database again: every request needs the session, and each read is a round
 * trip to a database far away. Ending a session in the API (signing out, a
 * new password) forgets it at once; one ended from the users CLI, another
 * process, stops working within this time.
 */
const REMEMBER_MS = 30_000;

export interface SessionUser {
  readonly id: string;
  readonly username: string;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

interface Remembered {
  readonly user: SessionUser;
  readonly until: number;
}

const remembered = new Map<string, Remembered>();

/** Forgets every remembered session of an account (after its sessions are deleted). */
export function forgetUserSessions(userId: string): void {
  for (const [tokenHash, entry] of remembered) {
    if (entry.user.id === userId) remembered.delete(tokenHash);
  }
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(now + SESSION_LIFETIME_MS),
  });
  // Expired sessions are cleared as new ones are made, without holding up the sign-in.
  void db.delete(sessions).where(lt(sessions.expiresAt, new Date(now))).catch(() => undefined);
  return token;
}

/** The account a token signs in, if the session is live; renews it when due. */
export async function findSessionUser(db: Db, token: string | undefined): Promise<SessionUser | undefined> {
  if (token === undefined || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return undefined;
  const tokenHash = hashToken(token);
  const now = new Date();
  const known = remembered.get(tokenHash);
  if (known !== undefined && known.until > now.getTime()) return known.user;
  remembered.delete(tokenHash);
  const [row] = await db.select({
    id: users.id, username: users.username, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  if (row === undefined) return undefined;
  let expiresAt = row.expiresAt.getTime();
  if (now.getTime() - row.lastSeenAt.getTime() > RENEW_AFTER_MS) {
    expiresAt = now.getTime() + SESSION_LIFETIME_MS;
    await db.update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(expiresAt) })
      .where(eq(sessions.tokenHash, tokenHash));
  }
  const user = { id: row.id, username: row.username };
  remembered.set(tokenHash, { user, until: Math.min(now.getTime() + REMEMBER_MS, expiresAt) });
  return user;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token === undefined) return;
  const tokenHash = hashToken(token);
  remembered.delete(tokenHash);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Inside a transaction, call `forgetUserSessions` again once it has committed. */
export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  forgetUserSessions(userId);
  await db.delete(sessions).where(eq(sessions.userId, userId));
  forgetUserSessions(userId);
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
