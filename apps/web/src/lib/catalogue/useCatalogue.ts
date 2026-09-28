import { useMemo } from "react";
import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";
import type {
  CollectionResponse,
  DesignTypeResponse,
  ReferenceListResponse,
} from "@retr0vault/shared";

import {
  fetchCollections,
  fetchDesignTypes,
  fetchReferences,
  fetchStats,
} from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";

import { filterQuery, filterToParams, type CatalogueFilter } from "./filters";

const designTypesQuery = queryOptions({
  queryKey: queryKeys.designTypes(),
  queryFn: ({ signal }) => fetchDesignTypes(signal),
});

const collectionsQuery = queryOptions({
  queryKey: queryKeys.collections(),
  queryFn: ({ signal }) => fetchCollections(signal),
});

const statsQuery = queryOptions({
  queryKey: queryKeys.stats(),
  queryFn: ({ signal }) => fetchStats(signal),
});

function catalogueReferencesQuery(filter: CatalogueFilter) {
  return infiniteQueryOptions({
    queryKey: queryKeys.catalogue(
      filter.kind,
      filter.kind === "all" ? null : filter.slug,
      filterQuery(filter),
    ),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchReferences(filterToParams(filter, pageParam), signal),
    getNextPageParam: (lastPage: ReferenceListResponse) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
}

export function useDesignTypes() {
  return useQuery(designTypesQuery);
}

export function useCollections() {
  return useQuery(collectionsQuery);
}

export function useStats() {
  return useQuery(statsQuery);
}

/**
 * Starts reading what the vault's rooms show first, before they are open:
 * after signing in, while the stamp lands and the doors are still shut. The
 * database is far away, so the rooms arrive filled rather than filling. With a
 * `filter`, that catalogue's first page of plates is read too.
 */
export function prefetchVault(client: QueryClient, filter: CatalogueFilter | null): void {
  void client.prefetchQuery(designTypesQuery);
  void client.prefetchQuery(collectionsQuery);
  void client.prefetchQuery(statsQuery);
  if (filter !== null) void client.prefetchInfiniteQuery(catalogueReferencesQuery(filter));
}

/**
 * Pages of references for one catalogue filter. `catalogueIndex` is assigned by
 * the backend against the whole filtered result set, so plate numbers stay
 * continuous as further pages are appended.
 */
export function useCatalogueReferences(filter: CatalogueFilter) {
  const query = useInfiniteQuery(catalogueReferencesQuery(filter));

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  return { ...query, items, total };
}

/** Design types keyed by id, for resolving a reference's category name. */
export function useDesignTypeIndex(
  designTypes: readonly DesignTypeResponse[] | undefined,
): ReadonlyMap<string, DesignTypeResponse> {
  return useMemo(() => {
    const index = new Map<string, DesignTypeResponse>();
    for (const designType of designTypes ?? []) {
      index.set(designType.id, designType);
    }
    return index;
  }, [designTypes]);
}

/** Pinned collections lead the filter rail's collection group. */
export function pinnedCollections(
  collections: readonly CollectionResponse[] | undefined,
): readonly CollectionResponse[] {
  return [...(collections ?? [])]
    .filter((collection) => collection.isPinned)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
