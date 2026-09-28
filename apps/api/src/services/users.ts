import { randomUUID } from "node:crypto";

import { asc, eq, isNull, sql } from "drizzle-orm";

import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth/passwords.js";
import { deleteUserSessions, forgetUserSessions } from "../auth/sessions.js";
import type { Db } from "../database/connection.js";
import { collections, references, users } from "../database/schema.js";
import { ApiError, databaseErrorCode, PgCode } from "../errors.js";

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/u;

export interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
}

function assertPassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new ApiError(400, "INVALID_PASSWORD", `A password has ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`);
  }
}

export async function createUser(db: Db, username: string, password: string): Promise<{ id: string; username: string }> {
  if (!USERNAME_PATTERN.test(username)) {
    throw new ApiError(400, "INVALID_USERNAME", "A username has 3 to 32 letters, digits, dots, dashes or underscores");
  }
  assertPassword(password);
  const id = randomUUID();
  try {
    await db.insert(users).values({ id, username, usernameKey: username.toLowerCase(), passwordHash: await hashPassword(password) });
  } catch (error) {
    if (databaseErrorCode(error) === PgCode.uniqueViolation) {
      throw new ApiError(409, "USERNAME_TAKEN", "An account with that username already exists");
    }
    throw error;
  }
  return { id, username };
}

export async function findUserByUsername(db: Db, username: string): Promise<UserRow | undefined> {
  const [row] = await db.select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
    .from(users).where(eq(users.usernameKey, username.trim().toLowerCase()));
  return row;
}

/** A new password signs out every session of the account. */
export async function setPassword(db: Db, userId: string, password: string): Promise<void> {
  assertPassword(password);
  const passwordHash = await hashPassword(password);
  await db.transaction(async (transaction) => {
    await transaction.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    await deleteUserSessions(transaction, userId);
  });
  // A session read while the transaction was open could have been remembered again.
  forgetUserSessions(userId);
}

export async function listUsers(db: Db) {
  return db.select({
    id: users.id,
    username: users.username,
    createdAt: users.createdAt,
    // Qualified by hand: inside the subquery a bare "id" would be the subquery's own.
    references: sql<number>`(select count(*)::integer from "references" r where r.owner_id = "users"."id")`,
    collections: sql<number>`(select count(*)::integer from collections c where c.owner_id = "users"."id")`,
  }).from(users).orderBy(asc(users.usernameKey));
}

/** Gives every reference and collection that has no owner to this account. */
export async function adoptUnowned(db: Db, userId: string): Promise<{ references: number; collections: number }> {
  return db.transaction(async (transaction) => {
    const adoptedReferences = await transaction.update(references).set({ ownerId: userId })
      .where(isNull(references.ownerId)).returning({ id: references.id });
    const adoptedCollections = await transaction.update(collections).set({ ownerId: userId })
      .where(isNull(collections.ownerId)).returning({ id: collections.id });
    return { references: adoptedReferences.length, collections: adoptedCollections.length };
  });
}
