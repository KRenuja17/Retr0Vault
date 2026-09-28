import { z } from "zod";

/** Signing in to the vault. */
export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
}).strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.uuid(),
  username: z.string().min(1),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const sessionResponseSchema = z.object({ user: sessionUserSchema });

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * The front door's contact strip and counters: the newest plates of the whole
 * archive, whoever filed them, readable before signing in.
 */
export const showcaseResponseSchema = z.object({
  references: z.array(z.object({
    id: z.uuid(),
    title: z.string().min(1),
    updatedAt: z.iso.datetime(),
  })),
  counts: z.object({
    plates: z.number().int().min(0),
    motionStudies: z.number().int().min(0),
    designTypes: z.number().int().min(0),
  }),
});

export type ShowcaseResponse = z.infer<typeof showcaseResponseSchema>;
