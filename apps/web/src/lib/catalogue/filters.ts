import type { ReferenceListParams } from "@/lib/api/endpoints";

/** Which slice of the archive a catalogue route is showing. */
export type CatalogueFilter =
  | { readonly kind: "all" }
  | { readonly kind: "designType"; readonly slug: string }
  | { readonly kind: "collection"; readonly slug: string };

export const ALL_FILTER: CatalogueFilter = { kind: "all" };

/** How many plates one page of the catalogue holds. */
export const CATALOGUE_PAGE_SIZE = 24;

/** Turns a route filter into backend list-query parameters. */
export function filterToParams(
  filter: CatalogueFilter,
  page: number,
): ReferenceListParams {
  const base: ReferenceListParams = {
    page,
    limit: CATALOGUE_PAGE_SIZE,
    sort: "newest",
    includeCatalogueIndex: true,
  };

  switch (filter.kind) {
    case "designType":
      return { ...base, designType: filter.slug };
    case "collection":
      return { ...base, collection: filter.slug };
    case "all":
      return base;
  }
}

/** The route a filter lives at, so tabs and history stay in step. */
export function filterToPath(filter: CatalogueFilter): string {
  switch (filter.kind) {
    case "designType":
      return `/type/${filter.slug}`;
    case "collection":
      return `/collection/${filter.slug}`;
    case "all":
      return "/all";
  }
}

export function isSameFilter(a: CatalogueFilter, b: CatalogueFilter): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return a.kind === "all" || b.kind === "all" || a.slug === b.slug;
}

/**
 * Reads the catalogue a reference was opened from, carried in history state so
 * closing the modal returns to the same slice. History state is untrusted — a
 * reload or a hand-edited entry can put anything there — so it is validated
 * rather than cast.
 */
export function originFromState(state: unknown): CatalogueFilter {
  if (typeof state !== "object" || state === null || !("origin" in state)) {
    return ALL_FILTER;
  }
  const origin = (state as { origin: unknown }).origin;
  if (typeof origin !== "object" || origin === null || !("kind" in origin)) {
    return ALL_FILTER;
  }

  const candidate = origin as { kind: unknown; slug?: unknown };
  if (candidate.kind === "all") {
    return ALL_FILTER;
  }
  if (
    (candidate.kind === "designType" || candidate.kind === "collection") &&
    typeof candidate.slug === "string" &&
    candidate.slug.length > 0
  ) {
    return { kind: candidate.kind, slug: candidate.slug };
  }
  return ALL_FILTER;
}

/** A readable name for a filter when the catalogue's own label is not to hand. */
export function filterLabel(filter: CatalogueFilter): string {
  return filter.kind === "all" ? "Complete archive" : filter.slug;
}
