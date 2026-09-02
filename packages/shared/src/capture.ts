import { z } from "zod";

export const captureUrlSchema = z.string().trim().min(1).max(2_048)
  .regex(/^[^\u0000-\u0020\u007f\\]*$/u, "URL must not contain backslashes, spaces or control characters")
  .url()
  .superRefine((value, context) => {
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
        /[\u0000-\u0020\u007f\\]/u.test(value)) {
      context.addIssue({ code: "custom", message: "Use an HTTP(S) URL on its standard port, without credentials, backslashes or control characters" });
    }
  }).transform((value) => new URL(value).href);

export const createWebsiteReferenceSchema = z.object({
  url: captureUrlSchema,
  title: z.string().trim().min(1).max(300).optional(),
  designTypeId: z.uuid().optional(),
  fullPage: z.boolean().default(false),
}).strict();

export type CreateWebsiteReferenceInput = z.infer<typeof createWebsiteReferenceSchema>;

export const referenceFrameSchema = z.object({
  id: z.uuid(),
  referenceId: z.uuid(),
  frameType: z.enum(["viewport", "hero", "scroll", "fullpage"]),
  imagePath: z.string(),
  sortOrder: z.number().int().nonnegative(),
}).strict();
export type ReferenceFrame = z.infer<typeof referenceFrameSchema>;
