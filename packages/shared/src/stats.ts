import { z } from "zod";

import { motionStatsSchema, motionTriggerSchema } from "./motion.js";

const countSchema = z.number().int().nonnegative();
const groupCountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  referenceCount: countSchema,
}).strict();

export const statsResponseSchema = z.object({
  totalReferences: countSchema,
  pendingReferences: countSchema,
  analyzedReferences: countSchema,
  unassignedReferences: countSchema,
  countsByDesignType: z.array(groupCountSchema),
  countsByCollection: z.array(groupCountSchema),
  motionStudies: motionStatsSchema,
  countsByTrigger: z.array(z.object({ trigger: motionTriggerSchema, count: countSchema }).strict()),
}).strict();

export type StatsResponse = z.infer<typeof statsResponseSchema>;
