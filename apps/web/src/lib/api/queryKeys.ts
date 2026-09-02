import type { ReferenceListParams } from "./endpoints";

/** One place to derive every TanStack Query key, so invalidation stays sane. */
export const queryKeys = {
  health: () => ["health"] as const,
  stats: () => ["stats"] as const,
  designTypes: () => ["design-types"] as const,
  designType: (slug: string) => ["design-types", slug] as const,
  collections: () => ["collections"] as const,
  references: (params: ReferenceListParams) => ["references", params] as const,
  reference: (id: string) => ["references", "detail", id] as const,
} as const;
