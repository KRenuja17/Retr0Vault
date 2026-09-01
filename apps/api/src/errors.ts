export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function sqliteErrorCode(error: unknown): string | undefined {
  const visited = new Set<object>();
  let candidate = error;

  while (typeof candidate === "object" && candidate !== null) {
    if (visited.has(candidate)) {
      return undefined;
    }
    visited.add(candidate);

    if ("code" in candidate && typeof candidate.code === "string") {
      return candidate.code;
    }

    candidate = "cause" in candidate ? candidate.cause : undefined;
  }

  return undefined;
}
