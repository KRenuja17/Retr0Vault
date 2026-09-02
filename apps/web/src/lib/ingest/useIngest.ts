import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AnalysisStatus,
  ReferenceResponse,
  UpdateReferenceInput,
} from "@retr0vault/shared";

import {
  createImageReference,
  createWebsiteReference,
  fetchPendingAnalysis,
  fetchReferences,
  importAnalyses,
  patchReference,
  resetAnalysis,
  type CreateImageReferenceInput,
  type CreateWebsiteReferenceRequest,
} from "@/lib/api/endpoints";
import { queryKeys, REFERENCES_KEY_PREFIX } from "@/lib/api/queryKeys";

/** How many recent accessions the ledger prints. */
export const LEDGER_SIZE = 12;

/**
 * Everything the reference table feeds: catalogue pages, detail sheets, the
 * ledger, the status counts and the live filter counts. Ingesting or
 * re-analysing anything invalidates the lot in one call, so no view can be
 * left showing a count the archive no longer holds.
 */
export function useArchiveInvalidation(): () => Promise<void> {
  const queryClient = useQueryClient();

  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: REFERENCES_KEY_PREFIX }),
      queryClient.invalidateQueries({ queryKey: queryKeys.stats() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.designTypes() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.collections() }),
    ]);
  }, [queryClient]);
}

/** The newest references, whatever their analysis status. */
export function useAccessionLedger(limit: number = LEDGER_SIZE) {
  return useQuery({
    queryKey: queryKeys.accessionLedger(limit),
    queryFn: ({ signal }) =>
      fetchReferences({ page: 1, limit, sort: "newest" }, signal),
  });
}

/**
 * How many references carry one analysis status. `/stats` counts pending and
 * analyzed only, so failed and manual are read as the `total` of a one-row
 * list query rather than by adding a field to the stats contract.
 */
export function useStatusCount(status: AnalysisStatus) {
  return useQuery({
    queryKey: queryKeys.statusCount(status),
    queryFn: ({ signal }) =>
      fetchReferences({ page: 1, limit: 1, status }, signal),
    select: (page) => page.total,
  });
}

export function useImageAccession() {
  const invalidate = useArchiveInvalidation();

  return useMutation<ReferenceResponse, unknown, CreateImageReferenceInput>({
    mutationFn: (input) => createImageReference(input),
    onSuccess: () => invalidate(),
  });
}

export function useWebsiteAccession() {
  const invalidate = useArchiveInvalidation();

  return useMutation<ReferenceResponse, unknown, CreateWebsiteReferenceRequest>({
    mutationFn: (input) => createWebsiteReference(input),
    onSuccess: () => invalidate(),
  });
}

export interface AnalysisImportRequest {
  readonly analyses: readonly unknown[];
  readonly overwriteProtected: boolean;
}

export function useAnalysisImport() {
  const invalidate = useArchiveInvalidation();

  return useMutation({
    mutationFn: (request: AnalysisImportRequest) =>
      importAnalyses(request.analyses, request.overwriteProtected),
    onSuccess: () => invalidate(),
  });
}

export function useAnalysisReset() {
  const invalidate = useArchiveInvalidation();

  return useMutation({
    mutationFn: (referenceId: string) => resetAnalysis(referenceId),
    onSuccess: () => invalidate(),
  });
}

export interface MetadataUpdate {
  readonly referenceId: string;
  readonly patch: UpdateReferenceInput;
}

export function useMetadataUpdate() {
  const invalidate = useArchiveInvalidation();

  return useMutation({
    mutationFn: ({ referenceId, patch }: MetadataUpdate) =>
      patchReference(referenceId, patch),
    onSuccess: () => invalidate(),
  });
}

/**
 * The pending-analysis manifest, fetched on demand rather than held in cache:
 * an export is only ever wanted as of the moment it is asked for.
 */
export function usePendingManifest() {
  return useMutation({ mutationFn: () => fetchPendingAnalysis() });
}
