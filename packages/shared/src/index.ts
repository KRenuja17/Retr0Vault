import { z } from "zod";

export * from "./collections.js";
export * from "./design-types.js";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("retr0vault-api"),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
  database: z.literal("ready"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    statusCode: z.number().int().min(400).max(599),
  }),
  requestId: z.string().min(1),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
