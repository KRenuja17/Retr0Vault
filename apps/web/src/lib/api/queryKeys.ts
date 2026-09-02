import type { ReferenceListParams } from "./endpoints";

/** One place to derive every TanStack Query key, so invalidation stays sane. */
export const queryKeys = {
  health: () => ["health"] as const,
  stats: () => ["stats"] as const,
  designTypes: () => ["design-types"] as const,
  designType: (slug: string) => ["design-types", slug] as const,
  collections: () => ["collections"] as const,
  references: (params: ReferenceListParams) => ["references", params] as const,
  /** Paged catalogue for one route filter; slug is null for the whole archive. */
  catalogue: (kind: string, slug: string | null) =>
    ["references", "catalogue", kind, slug] as const,
  reference: (id: string) => ["references", "detail", id] as const,
} as const;
