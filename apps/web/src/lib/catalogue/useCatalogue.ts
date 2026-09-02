import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
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

import { filterToParams, type CatalogueFilter } from "./filters";

export function useDesignTypes() {
  return useQuery({
    queryKey: queryKeys.designTypes(),
    queryFn: ({ signal }) => fetchDesignTypes(signal),
  });
}

export function useCollections() {
  return useQuery({
    queryKey: queryKeys.collections(),
    queryFn: ({ signal }) => fetchCollections(signal),
  });
}

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats(),
    queryFn: ({ signal }) => fetchStats(signal),
  });
}

/**
 * Pages of references for one catalogue filter. `catalogueIndex` is assigned by
 * the backend against the whole filtered result set, so plate numbers stay
 * continuous as further pages are appended.
 */
export function useCatalogueReferences(filter: CatalogueFilter) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.catalogue(
      filter.kind,
      filter.kind === "all" ? null : filter.slug,
    ),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      fetchReferences(filterToParams(filter, pageParam), signal),
    getNextPageParam: (lastPage: ReferenceListResponse) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });

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
