export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Postgres SQLSTATE codes the services map to API errors. */
export const PgCode = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  notNullViolation: "23502",
  invalidText: "22P02",
  serializationFailure: "40001",
  deadlockDetected: "40P01",
  lockNotAvailable: "55P03",
  tooManyConnections: "53300",
} as const;

/**
 * The SQLSTATE of a database error, found by walking the `cause` chain (Drizzle
 * wraps the driver's error). Only five-character SQLSTATE codes count, so
 * Node's own error codes (ECONNREFUSED and so on) are not mistaken for them.
 */
export function databaseErrorCode(error: unknown): string | undefined {
  const visited = new Set<object>();
  let candidate = error;

  while (typeof candidate === "object" && candidate !== null) {
    if (visited.has(candidate)) {
      return undefined;
    }
    visited.add(candidate);

    if ("code" in candidate && typeof candidate.code === "string" && /^[0-9A-Z]{5}$/u.test(candidate.code)) {
      return candidate.code;
    }

    candidate = "cause" in candidate ? candidate.cause : undefined;
  }

  return undefined;
}

/** Errors that mean "retry shortly": contention, not a bad request. */
export function isTransientDatabaseError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return code === PgCode.serializationFailure || code === PgCode.deadlockDetected ||
    code === PgCode.lockNotAvailable || code === PgCode.tooManyConnections;
}
