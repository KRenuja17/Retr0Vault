import type {
  CollectionResponse,
  DesignTypeResponse,
  HealthResponse,
  ReferenceListResponse,
  ReferenceResponse,
  StatsResponse,
} from "@retr0vault/shared";

import { apiRequest } from "./client";

/**
 * Thin, typed wrappers over the backend routes registered in apps/api. Types
 * come from @retr0vault/shared, so a contract change is a compile error here.
 */

export function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiRequest<HealthResponse>("/health", { signal: signal ?? null });
}

export function fetchStats(signal?: AbortSignal): Promise<StatsResponse> {
  return apiRequest<StatsResponse>("/stats", { signal: signal ?? null });
}

export function fetchDesignTypes(
  signal?: AbortSignal,
): Promise<readonly DesignTypeResponse[]> {
  return apiRequest<DesignTypeResponse[]>("/design-types", {
    signal: signal ?? null,
  });
}

export function fetchDesignType(
  slug: string,
  signal?: AbortSignal,
): Promise<DesignTypeResponse> {
  return apiRequest<DesignTypeResponse>(
    `/design-types/${encodeURIComponent(slug)}`,
    { signal: signal ?? null },
  );
}

export function fetchCollections(
  signal?: AbortSignal,
): Promise<readonly CollectionResponse[]> {
  return apiRequest<CollectionResponse[]>("/collections", {
    signal: signal ?? null,
  });
}

export interface ReferenceListParams {
  readonly q?: string | undefined;
  readonly designType?: string | undefined;
  readonly collection?: string | undefined;
  readonly status?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly sort?: string | undefined;
  readonly includeCatalogueIndex?: boolean | undefined;
}

export function fetchReferences(
  params: ReferenceListParams = {},
  signal?: AbortSignal,
): Promise<ReferenceListResponse> {
  return apiRequest<ReferenceListResponse>("/references", {
    signal: signal ?? null,
    searchParams: {
      ...params,
      includeCatalogueIndex:
        params.includeCatalogueIndex === undefined
          ? undefined
          : String(params.includeCatalogueIndex),
    },
  });
}

export function fetchReference(
  id: string,
  signal?: AbortSignal,
): Promise<ReferenceResponse> {
  return apiRequest<ReferenceResponse>(
    `/references/${encodeURIComponent(id)}`,
    { signal: signal ?? null },
  );
}
