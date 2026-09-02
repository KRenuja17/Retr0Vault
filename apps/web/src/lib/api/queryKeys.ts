import type { ReferenceListParams } from "./endpoints";

/** One place to derive every TanStack Query key, so invalidation stays sane. */
export const queryKeys = {
  health: () => ["health"] as const,
  stats: () => ["stats"] as const,
  designTypes: () => ["design-types"] as const,
  designType: (slug: string) => ["design-types", slug] as const,
  collections: () => ["collections"] as const,
  references: (params: ReferenceListParams) => ["references", params] as const,
  /**
   * Paged catalogue for one route filter; slug is null for the whole archive
   * and query is "" when nothing is being searched for. The query is part of
   * the key so a search is its own cached result set rather than overwriting
   * the unsearched pages of the same slice.
   */
  catalogue: (kind: string, slug: string | null, query: string) =>
    ["references", "catalogue", kind, slug, query] as const,
  reference: (id: string) => ["references", "detail", id] as const,
  /** Newest references of any status, for the accession ledger. */
  accessionLedger: (limit: number) => ["references", "ledger", limit] as const,
  /** `total` for one analysis status; the stats route counts only two of them. */
  statusCount: (status: string) => ["references", "status-count", status] as const,
} as const;

/**
 * Everything derived from the reference table. Ingesting, importing, resetting
 * or editing invalidates this one prefix, which covers the catalogue pages, the
 * detail sheets, the ledger and the status counts.
 */
export const REFERENCES_KEY_PREFIX = ["references"] as const;
