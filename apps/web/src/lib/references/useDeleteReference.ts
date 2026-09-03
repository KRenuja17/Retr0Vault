import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import type { ReferenceListResponse } from "@retr0vault/shared";

import { ApiError } from "@/lib/api/client";
import { deleteReference } from "@/lib/api/endpoints";
import { queryKeys, REFERENCES_KEY_PREFIX } from "@/lib/api/queryKeys";
import { useSelection } from "@/lib/selection/SelectionProvider";

/** The cached shape of one catalogue slice: pages of a paged reference list. */
type CataloguePages = InfiniteData<ReferenceListResponse, number>;

/**
 * A 404 on the delete itself means the archive no longer holds the reference —
 * someone else removed it, or this tab is acting on a stale plate. The row is
 * gone either way, which is what the reader asked for, so it is treated as
 * success rather than reported as a failure they can do nothing about.
 */
export function isAlreadyGone(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}

/**
 * Drops one reference from every cached catalogue slice, in place.
 *
 * Invalidation alone would get there, but only after a round trip: the plate
 * would stay on screen behind the closing sheet until the refetch landed. This
 * removes it in the same tick, and the refetch that follows re-establishes the
 * authoritative paging and plate numbers.
 */
export function pruneReferenceFromCatalogues(
  queryClient: QueryClient,
  id: string,
): void {
  queryClient.setQueriesData<CataloguePages>(
    { queryKey: [...REFERENCES_KEY_PREFIX, "catalogue"] },
    (data) => {
      if (data === undefined) {
        return data;
      }

      let removed = 0;
      const pages = data.pages.map((page) => {
        const items = page.items.filter((item) => item.id !== id);
        removed += page.items.length - items.length;
        return items.length === page.items.length ? page : { ...page, items };
      });

      if (removed === 0) {
        return data;
      }

      /*
       * `total` drives the "showing N of N" marginalia and every plate number,
       * so it has to come down with the item rather than wait for the refetch.
       */
      return {
        ...data,
        pages: pages.map((page) => ({
          ...page,
          total: Math.max(0, page.total - removed),
        })),
      };
    },
  );
}

/**
 * Permanently removes a reference from the archive.
 *
 * Deleting a reference moves more of the app than any other single action: the
 * catalogue slices, the rail's design-type and collection counts, the archive
 * statistics, the reference's own cached sheet, and the working selection if
 * the plate happened to be marked. All of it is settled here so no caller has
 * to remember the list.
 */
export function useDeleteReference() {
  const queryClient = useQueryClient();
  const selection = useSelection();

  return useMutation<void, unknown, string>({
    mutationFn: async (id) => {
      try {
        await deleteReference(id);
      } catch (error) {
        if (!isAlreadyGone(error)) {
          throw error;
        }
      }
    },
    onSuccess: async (_result, id) => {
      // A mark on a plate that no longer exists would export a dead id.
      selection?.discard(id);

      pruneReferenceFromCatalogues(queryClient, id);
      // The sheet's own cache entry, so a stale detail is never served back.
      queryClient.removeQueries({ queryKey: queryKeys.reference(id) });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: REFERENCES_KEY_PREFIX }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats() }),
        // Both carry live per-slice counts in the filter rail.
        queryClient.invalidateQueries({ queryKey: queryKeys.designTypes() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.collections() }),
      ]);
    },
  });
}
