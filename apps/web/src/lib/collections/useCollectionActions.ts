import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CollectionResponse,
  CreateCollectionInput,
  UpdateCollectionInput,
} from "@retr0vault/shared";

import {
  addReferenceToCollection,
  createCollection,
  deleteCollection,
  patchCollection,
  removeReferenceFromCollection,
} from "@/lib/api/endpoints";
import { queryKeys, REFERENCES_KEY_PREFIX } from "@/lib/api/queryKeys";

/**
 * Every view a collection change can move: the collection list itself (names,
 * pins, live counts), the reference pages (a `/collection/:slug` catalogue and
 * each reference's own `collectionIds`), and the archive statistics.
 *
 * One invalidation covers all of them, so no rail tab, count or membership
 * list is left showing a collection the archive no longer holds.
 */
export function useCollectionInvalidation(): () => Promise<void> {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.collections() }),
      queryClient.invalidateQueries({ queryKey: REFERENCES_KEY_PREFIX }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats() }),
    ]);
  }, [queryClient]);
}

export function useCreateCollection() {
  const invalidate = useCollectionInvalidation();

  return useMutation<CollectionResponse, unknown, CreateCollectionInput>({
    mutationFn: (input) => createCollection(input),
    onSuccess: () => invalidate(),
  });
}

export interface CollectionUpdate {
  readonly id: string;
  readonly patch: UpdateCollectionInput;
}

export function useUpdateCollection() {
  const invalidate = useCollectionInvalidation();

  return useMutation<CollectionResponse, unknown, CollectionUpdate>({
    mutationFn: ({ id, patch }) => patchCollection(id, patch),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteCollection() {
  const invalidate = useCollectionInvalidation();

  return useMutation<void, unknown, string>({
    mutationFn: (id) => deleteCollection(id),
    onSuccess: () => invalidate(),
  });
}

export interface MembershipChange {
  readonly collectionId: string;
  readonly referenceId: string;
  /** True adds the reference to the collection, false removes it. */
  readonly member: boolean;
}

/** One mutation for both directions, so a row can only be in flight once. */
export function useCollectionMembership() {
  const invalidate = useCollectionInvalidation();

  return useMutation<void, unknown, MembershipChange>({
    mutationFn: ({ collectionId, referenceId, member }) =>
      member
        ? addReferenceToCollection(collectionId, referenceId)
        : removeReferenceFromCollection(collectionId, referenceId),
    onSuccess: () => invalidate(),
  });
}
