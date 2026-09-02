import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";

const loopbackAuthority = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9]\d{0,4}))?$/iu;

export async function registerLocalAccess(app: FastifyInstance, port: number): Promise<void> {
  const origins = new Set([4610, port].flatMap((allowedPort) =>
    ["localhost", "127.0.0.1", "[::1]"].map((host) => `http://${host}:${allowedPort}`)));

  // CORS alone does not prevent cross-origin writes. Reject untrusted origins
  // before any handler, and reject non-loopback Host values (DNS rebinding).
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    const authority = request.headers.host ?? "";
    const match = loopbackAuthority.exec(authority);
    if (!match || (match[1] !== undefined && Number(match[1]) > 65_535)) {
      throw new ApiError(403, "LOCAL_HOST_REQUIRED", "Only a loopback Host is allowed");
    }
    const origin = request.headers.origin;
    if ((origin !== undefined && !origins.has(origin)) ||
        (origin === undefined && request.headers["sec-fetch-site"] === "cross-site")) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed");
    }
  });
  await app.register(cors, {
    origin: [...origins],
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    exposedHeaders: ["Content-Disposition"],
    credentials: false,
    strictPreflight: true,
    maxAge: 600,
  });
}
