import { useCallback, useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MotionListResponse,
  MotionStudy,
  MotionTrigger,
  UpdateMotionClipInput,
  UpdateMotionStudyInput,
} from "@retr0vault/shared";

import { ApiError } from "@/lib/api/client";
import {
  deleteMotionClip,
  deleteMotionStudy,
  fetchClipEnergy,
  fetchMotionList,
  fetchMotionStudy,
  fetchPendingMotion,
  importMotionAnalyses,
  patchMotionClip,
  patchMotionStudy,
  retryMotionClip,
  uploadMotionClip,
  type UploadMotionClipInput,
} from "@/lib/api/endpoints";
import { MOTION_KEY_PREFIX, queryKeys, REFERENCES_KEY_PREFIX } from "@/lib/api/queryKeys";

export const MOTION_PAGE_SIZE = 24;

/** While a clip is queued or processing, the study is re-read on this cadence. */
export const PROCESSING_POLL_MS = 2_000;

export function isProcessing(study: MotionStudy | undefined): boolean {
  return study?.clips.some((clip) => clip.processingStatus === "queued" || clip.processingStatus === "processing") ?? false;
}

/**
 * A motion write changes the Motion section, the study sheet, the reference's
 * motion summary (catalogue marker) and the stats counts.
 */
export function useMotionInvalidation(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MOTION_KEY_PREFIX }),
      queryClient.invalidateQueries({ queryKey: REFERENCES_KEY_PREFIX }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats() }),
    ]);
  }, [queryClient]);
}

export interface MotionFilter {
  readonly trigger: MotionTrigger | null;
  readonly query: string;
}

export function useMotionList(filter: MotionFilter) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.motionList(filter.trigger, filter.query),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchMotionList({
      page: pageParam,
      limit: MOTION_PAGE_SIZE,
      includeCatalogueIndex: true,
      ...(filter.trigger === null ? {} : { trigger: filter.trigger }),
      ...(filter.query.length > 0 ? { q: filter.query } : {}),
    }, signal),
    getNextPageParam: (lastPage: MotionListResponse) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    // Cards of clips still being processed refresh until they are ready.
    refetchInterval: (current) =>
      current.state.data?.pages.some((page) => page.items.some((item) =>
        item.primaryClip !== null && (item.primaryClip.processingStatus === "queued" || item.primaryClip.processingStatus === "processing")))
        ? PROCESSING_POLL_MS : false,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const countsByTrigger = query.data?.pages[0]?.countsByTrigger ?? [];
  return { ...query, items, total, countsByTrigger };
}

/** The whole-archive trigger counts for the rail, independent of the active filter. */
export function useMotionTotals() {
  return useQuery({
    queryKey: queryKeys.motionListParams({ limit: 1 }),
    queryFn: ({ signal }) => fetchMotionList({ limit: 1 }, signal),
  });
}

/** The study behind a sheet; polls while any of its clips is still processing. */
export function useMotionStudy(referenceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.motionStudy(referenceId),
    queryFn: ({ signal }) => fetchMotionStudy(referenceId, signal),
    enabled,
    retry: (count, error) => !(error instanceof ApiError && error.statusCode < 500) && count < 1,
    refetchInterval: (current) => (isProcessing(current.state.data) ? PROCESSING_POLL_MS : false),
  });
}

export function useClipEnergy(clipId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.clipEnergy(clipId ?? ""),
    queryFn: ({ signal }) => fetchClipEnergy(clipId!, signal),
    enabled: clipId !== undefined,
    staleTime: Infinity,
  });
}

export function useMotionUpload() {
  const invalidate = useMotionInvalidation();
  return useMutation<MotionStudy, unknown, UploadMotionClipInput>({
    mutationFn: (input) => uploadMotionClip(input),
    onSuccess: () => invalidate(),
  });
}

export function useMotionStudyUpdate(referenceId: string) {
  const invalidate = useMotionInvalidation();
  const queryClient = useQueryClient();
  return useMutation<MotionStudy, unknown, UpdateMotionStudyInput>({
    mutationFn: (patch) => patchMotionStudy(referenceId, patch),
    onSuccess: async (study) => {
      queryClient.setQueryData(queryKeys.motionStudy(referenceId), study);
      await invalidate();
    },
  });
}

export function useMotionClipUpdate(referenceId: string) {
  const invalidate = useMotionInvalidation();
  const queryClient = useQueryClient();
  return useMutation<MotionStudy, unknown, { clipId: string; patch: UpdateMotionClipInput }>({
    mutationFn: ({ clipId, patch }) => patchMotionClip(clipId, patch),
    onSuccess: async (study) => {
      queryClient.setQueryData(queryKeys.motionStudy(referenceId), study);
      await invalidate();
    },
  });
}

export function useMotionClipRemoval() {
  const invalidate = useMotionInvalidation();
  return useMutation<void, unknown, string>({
    mutationFn: (clipId) => deleteMotionClip(clipId),
    onSuccess: () => invalidate(),
  });
}

export function useMotionClipRetry() {
  const invalidate = useMotionInvalidation();
  return useMutation<MotionStudy, unknown, string>({
    mutationFn: (clipId) => retryMotionClip(clipId),
    onSuccess: () => invalidate(),
  });
}

export function useMotionStudyRemoval() {
  const invalidate = useMotionInvalidation();
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (referenceId) => deleteMotionStudy(referenceId),
    onSuccess: async (_result, referenceId) => {
      queryClient.removeQueries({ queryKey: queryKeys.motionStudy(referenceId) });
      await invalidate();
    },
  });
}

/** The pending-motion manifest, fetched when asked for rather than cached. */
export function usePendingMotionManifest() {
  return useMutation({ mutationFn: () => fetchPendingMotion() });
}

export function useMotionImport() {
  const invalidate = useMotionInvalidation();
  return useMutation({
    mutationFn: (request: { readonly analyses: readonly unknown[]; readonly overwriteProtected: boolean }) =>
      importMotionAnalyses(request.analyses, request.overwriteProtected),
    onSuccess: () => invalidate(),
  });
}
