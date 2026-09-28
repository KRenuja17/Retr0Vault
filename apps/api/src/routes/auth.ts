import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { spendVerificationTime, verifyPassword, PASSWORD_MAX_LENGTH } from "../auth/passwords.js";
import {
  createSession,
  deleteSession,
  findSessionUser,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  type SessionUser,
} from "../auth/sessions.js";
import { LoginThrottle } from "../auth/throttle.js";
import type { Db } from "../database/connection.js";
import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";
import { findUserByUsername } from "../services/users.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The signed-in account; set on every request past the sign-in guard. */
    user: SessionUser | null;
  }
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
}).strict();

/** Open without signing in: the health check, signing in and out, and the front door's showcase. */
function isPublic(path: string): boolean {
  return path === "/api/v1/health" ||
    path.startsWith("/api/v1/auth/") ||
    path === "/api/v1/showcase" ||
    /^\/api\/v1\/showcase\/[^/]+\/thumbnail$/u.test(path);
}

/** The signed-in account of a request that passed the guard. */
export function requireUser(request: FastifyRequest): SessionUser {
  if (request.user === null) throw new ApiError(401, "AUTH_REQUIRED", "Sign in to open the vault");
  return request.user;
}

export async function registerAuth(
  app: FastifyInstance,
  db: Db,
  options: { readonly secureCookies: boolean; readonly testUser?: SessionUser },
): Promise<void> {
  const throttle = new LoginThrottle();
  app.decorateRequest("user", null);

  // Every API route but the public ones needs a live session.
  app.addHook("onRequest", async (request) => {
    const path = request.url.split("?")[0] ?? "";
    if (!path.startsWith("/api/")) return;
    request.user = (await findSessionUser(db, readCookie(request.headers.cookie, SESSION_COOKIE))) ?? options.testUser ?? null;
    if (request.user === null && !isPublic(path)) {
      throw new ApiError(401, "AUTH_REQUIRED", "Sign in to open the vault");
    }
  });

  app.post("/api/v1/auth/login", { bodyLimit: 4_096 }, async (request, reply) => {
    const { username, password } = parseRequest(loginSchema, request.body);
    const keys = [`name:${username.toLowerCase()}`, `address:${request.ip}`];
    const wait = throttle.retryAfter(keys);
    if (wait > 0) {
      reply.header("Retry-After", String(wait));
      throw new ApiError(429, "AUTH_THROTTLED", `Too many failed attempts; try again in ${wait} seconds`);
    }

    const user = await findUserByUsername(db, username);
    const matches = user === undefined
      ? (await spendVerificationTime(password), false)
      : await verifyPassword(password, user.passwordHash);
    if (user === undefined || !matches) {
      const left = throttle.fail(keys);
      if (left === 0) reply.header("Retry-After", String(throttle.retryAfter(keys)));
      // One answer for a wrong name and a wrong password: which one is not said.
      throw new ApiError(401, "INVALID_CREDENTIALS",
        left > 0 ? `Those credentials do not open this vault. ${left} ${left === 1 ? "try" : "tries"} left before a pause.`
          : "Those credentials do not open this vault. Sign-in is paused for a moment.");
    }

    throttle.succeed(keys);
    const token = await createSession(db, user.id);
    reply.header("Set-Cookie", sessionCookie(token, options.secureCookies));
    request.log.info({ userId: user.id }, "Signed in");
    return { user: { id: user.id, username: user.username } };
  });

  app.get("/api/v1/auth/session", async (request) => {
    const user = requireUser(request);
    return { user: { id: user.id, username: user.username } };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await deleteSession(db, readCookie(request.headers.cookie, SESSION_COOKIE));
    reply.header("Set-Cookie", sessionCookie(null, options.secureCookies));
    return reply.status(204).send();
  });
}
