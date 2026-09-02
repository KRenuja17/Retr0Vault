import type { ReferenceListParams } from "@/lib/api/endpoints";

/**
 * Which slice of the archive a catalogue route is showing, and the search
 * query narrowing it. The slice comes from the route, the query from the `q`
 * search parameter, and the backend accepts both together — so a search inside
 * one design type or collection is one request, not a client-side filter.
 */
export type CatalogueFilter =
  | { readonly kind: "all"; readonly query?: string }
  | {
      readonly kind: "designType";
      readonly slug: string;
      readonly query?: string;
    }
  | {
      readonly kind: "collection";
      readonly slug: string;
      readonly query?: string;
    };

export const ALL_FILTER: CatalogueFilter = { kind: "all" };

/** How many plates one page of the catalogue holds. */
export const CATALOGUE_PAGE_SIZE = 24;

/** The search parameter carrying the query, on every catalogue route. */
export const QUERY_PARAM = "q";

/** The committed query on a filter, trimmed; empty string when there is none. */
export function filterQuery(filter: CatalogueFilter): string {
  return filter.query?.trim() ?? "";
}

/** The same slice, searched for `query`. An empty query clears the search. */
export function withQuery(
  filter: CatalogueFilter,
  query: string,
): CatalogueFilter {
  const trimmed = query.trim();
  const next = trimmed.length > 0 ? { query: trimmed } : {};
  return filter.kind === "all"
    ? { kind: "all", ...next }
    : { kind: filter.kind, slug: filter.slug, ...next };
}

/** Turns a route filter into backend list-query parameters. */
export function filterToParams(
  filter: CatalogueFilter,
  page: number,
): ReferenceListParams {
  const query = filterQuery(filter);
  const base: ReferenceListParams = {
    page,
    limit: CATALOGUE_PAGE_SIZE,
    // Relevance ordering is only meaningful against a query; without one the
    // archive reads newest first, as the catalogue always has.
    sort: query.length > 0 ? "relevance" : "newest",
    includeCatalogueIndex: true,
    ...(query.length > 0 ? { q: query } : {}),
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

/** The route a filter lives at, so tabs, history and search stay in step. */
export function filterToPath(filter: CatalogueFilter): string {
  const path =
    filter.kind === "designType"
      ? `/type/${filter.slug}`
      : filter.kind === "collection"
        ? `/collection/${filter.slug}`
        : "/all";
  const query = filterQuery(filter);
  return query.length > 0
    ? `${path}?${QUERY_PARAM}=${encodeURIComponent(query)}`
    : path;
}

/**
 * Whether two filters address the same slice. The query is deliberately
 * ignored: a design-type tab stays the active tab while a search narrows it.
 */
export function isSameFilter(a: CatalogueFilter, b: CatalogueFilter): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return a.kind === "all" || b.kind === "all" || a.slug === b.slug;
}

/**
 * Reads the catalogue a reference was opened from, carried in history state so
 * closing the modal returns to the same slice and the same search. History
 * state is untrusted — a reload or a hand-edited entry can put anything there —
 * so it is validated rather than cast.
 */
export function originFromState(state: unknown): CatalogueFilter {
  if (typeof state !== "object" || state === null || !("origin" in state)) {
    return ALL_FILTER;
  }
  const origin = (state as { origin: unknown }).origin;
  if (typeof origin !== "object" || origin === null || !("kind" in origin)) {
    return ALL_FILTER;
  }

  const candidate = origin as { kind: unknown; slug?: unknown; query?: unknown };
  const query = typeof candidate.query === "string" ? candidate.query : "";

  if (candidate.kind === "all") {
    return withQuery(ALL_FILTER, query);
  }
  if (
    (candidate.kind === "designType" || candidate.kind === "collection") &&
    typeof candidate.slug === "string" &&
    candidate.slug.length > 0
  ) {
    return withQuery({ kind: candidate.kind, slug: candidate.slug }, query);
  }
  return ALL_FILTER;
}

/** A readable name for a filter when the catalogue's own label is not to hand. */
export function filterLabel(filter: CatalogueFilter): string {
  return filter.kind === "all" ? "Complete archive" : filter.slug;
}
