import type { z } from "zod";

import { ApiError } from "../errors.js";

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (result.success) {
    return result.data;
  }

  const message = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "request";
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  throw new ApiError(400, "VALIDATION_ERROR", message);
}
