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
