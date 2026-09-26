import type {
  AnalysisImportReport,
  ClipEnergy,
  MotionImportReport,
  MotionListResponse,
  MotionStudy,
  PendingMotionManifest,
  UpdateMotionClipInput,
  UpdateMotionStudyInput,
  CollectionResponse,
  CreateCollectionInput,
  DesignTypeResponse,
  HealthResponse,
  PendingAnalysisManifest,
  ReferenceListResponse,
  ReferenceResponse,
  StatsResponse,
  UpdateCollectionInput,
  UpdateReferenceInput,
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

/**
 * Collections are user-curated groupings, kept separate from design types:
 * the archive never derives one from the other.
 */
export function createCollection(
  input: CreateCollectionInput,
): Promise<CollectionResponse> {
  return apiRequest<CollectionResponse>("/collections", {
    method: "POST",
    body: input,
  });
}

export function patchCollection(
  id: string,
  patch: UpdateCollectionInput,
): Promise<CollectionResponse> {
  return apiRequest<CollectionResponse>(
    `/collections/${encodeURIComponent(id)}`,
    { method: "PATCH", body: patch },
  );
}

export function deleteCollection(id: string): Promise<void> {
  return apiRequest<void>(`/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Membership routes answer 204; the reference itself is re-read afterwards. */
export function addReferenceToCollection(
  collectionId: string,
  referenceId: string,
): Promise<void> {
  return apiRequest<void>(
    `/collections/${encodeURIComponent(collectionId)}/references/${encodeURIComponent(referenceId)}`,
    // An explicit empty object: the route validates the body strictly.
    { method: "POST", body: {} },
  );
}

export function removeReferenceFromCollection(
  collectionId: string,
  referenceId: string,
): Promise<void> {
  return apiRequest<void>(
    `/collections/${encodeURIComponent(collectionId)}/references/${encodeURIComponent(referenceId)}`,
    { method: "DELETE" },
  );
}

export interface ReferenceListParams {
  /** Free-text query; the backend owns all matching and ranking. */
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

export interface CreateImageReferenceInput {
  readonly file: File;
  /** Omitted when blank; the backend files the plate as "Untitled Reference". */
  readonly title?: string | undefined;
  readonly sourceUrl?: string | undefined;
  readonly designTypeId?: string | undefined;
}

/**
 * Multipart image ingest. The optional fields are omitted rather than sent
 * empty: the backend field schema is strict, and an empty title fails its
 * minimum length instead of falling back to the default.
 */
export function createImageReference(
  input: CreateImageReferenceInput,
): Promise<ReferenceResponse> {
  const form = new FormData();
  const optional: ReadonlyArray<readonly [string, string | undefined]> = [
    ["title", input.title],
    ["sourceUrl", input.sourceUrl],
    ["designTypeId", input.designTypeId],
  ];
  for (const [name, value] of optional) {
    if (value !== undefined && value.length > 0) {
      form.append(name, value);
    }
  }
  // Appended last so the fields are parsed before the file is streamed.
  form.append("file", input.file, input.file.name);

  return apiRequest<ReferenceResponse>("/references/image", {
    method: "POST",
    body: form,
  });
}

export interface ReplaceReferenceImageInput {
  readonly referenceId: string;
  readonly file: File;
  /** File the reference back as pending, so its analysis is redone. */
  readonly resetAnalysis: boolean;
}

/** A new picture for a reference already filed; nothing else on it changes. */
export function replaceReferenceImage(
  input: ReplaceReferenceImageInput,
): Promise<ReferenceResponse> {
  const form = new FormData();
  form.append("resetAnalysis", String(input.resetAnalysis));
  form.append("file", input.file, input.file.name);
  return apiRequest<ReferenceResponse>(
    `/references/${encodeURIComponent(input.referenceId)}/image`,
    { method: "PUT", body: form },
  );
}

export interface CreateWebsiteReferenceRequest {
  readonly url: string;
  readonly title?: string | undefined;
  readonly designTypeId?: string | undefined;
  readonly fullPage?: boolean | undefined;
}

/** Playwright capture. One request that runs for as long as the capture does. */
export function createWebsiteReference(
  input: CreateWebsiteReferenceRequest,
): Promise<ReferenceResponse> {
  return apiRequest<ReferenceResponse>("/references/url", {
    method: "POST",
    body: {
      url: input.url,
      ...(input.title ? { title: input.title } : {}),
      ...(input.designTypeId ? { designTypeId: input.designTypeId } : {}),
      ...(input.fullPage === undefined ? {} : { fullPage: input.fullPage }),
    },
  });
}

export function patchReference(
  id: string,
  patch: UpdateReferenceInput,
): Promise<ReferenceResponse> {
  return apiRequest<ReferenceResponse>(
    `/references/${encodeURIComponent(id)}`,
    { method: "PATCH", body: patch },
  );
}

/**
 * Permanent withdrawal from the archive. The backend answers 204 and owns the
 * removal of the stored capture, thumbnail and frames along with the row, so
 * there is nothing for the client to clean up afterwards.
 */
export function deleteReference(id: string): Promise<void> {
  return apiRequest<void>(`/references/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchPendingAnalysis(
  signal?: AbortSignal,
): Promise<PendingAnalysisManifest> {
  return apiRequest<PendingAnalysisManifest>("/analysis/pending", {
    signal: signal ?? null,
  });
}

/** Each entry is validated separately by the backend; bad ones never abort the batch. */
export function importAnalyses(
  analyses: readonly unknown[],
  overwriteProtected: boolean,
): Promise<AnalysisImportReport> {
  return apiRequest<AnalysisImportReport>("/analysis/import", {
    method: "POST",
    body: { analyses, overwriteProtected },
  });
}

export function resetAnalysis(referenceId: string): Promise<ReferenceResponse> {
  return apiRequest<ReferenceResponse>(
    `/analysis/${encodeURIComponent(referenceId)}/reset`,
    // An explicit empty object: the route validates the body strictly.
    { method: "POST", body: {} },
  );
}

// ---------------------------------------------------------------------------
// Motion studies
// ---------------------------------------------------------------------------

export interface MotionListParams {
  readonly q?: string | undefined;
  readonly trigger?: string | undefined;
  readonly technique?: string | undefined;
  readonly status?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly sort?: string | undefined;
  readonly includeCatalogueIndex?: boolean | undefined;
}

export function fetchMotionList(
  params: MotionListParams = {},
  signal?: AbortSignal,
): Promise<MotionListResponse> {
  return apiRequest<MotionListResponse>("/motion", {
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

export function fetchMotionStudy(
  referenceId: string,
  signal?: AbortSignal,
): Promise<MotionStudy> {
  return apiRequest<MotionStudy>(
    `/references/${encodeURIComponent(referenceId)}/motion`,
    { signal: signal ?? null },
  );
}

export interface UploadMotionClipInput {
  readonly referenceId: string;
  readonly file: File;
  readonly label?: string | undefined;
  readonly posterMs?: number | undefined;
}

/**
 * Multipart recording upload. The API answers 202 as soon as the file is on
 * disk; processing continues in the background and is read back by polling.
 */
export function uploadMotionClip(input: UploadMotionClipInput): Promise<MotionStudy> {
  const form = new FormData();
  if (input.label !== undefined && input.label.length > 0) form.append("label", input.label);
  if (input.posterMs !== undefined) form.append("posterMs", String(Math.round(input.posterMs)));
  // Appended last so the fields are parsed before the file is streamed.
  form.append("file", input.file, input.file.name);
  return apiRequest<MotionStudy>(
    `/references/${encodeURIComponent(input.referenceId)}/motion/clips`,
    { method: "POST", body: form },
  );
}

export function patchMotionStudy(
  referenceId: string,
  patch: UpdateMotionStudyInput,
): Promise<MotionStudy> {
  return apiRequest<MotionStudy>(
    `/references/${encodeURIComponent(referenceId)}/motion`,
    { method: "PATCH", body: patch },
  );
}

/** Removes the study and its recordings; the reference itself stays. */
export function deleteMotionStudy(referenceId: string): Promise<void> {
  return apiRequest<void>(
    `/references/${encodeURIComponent(referenceId)}/motion`,
    { method: "DELETE" },
  );
}

export function patchMotionClip(
  clipId: string,
  patch: UpdateMotionClipInput,
): Promise<MotionStudy> {
  return apiRequest<MotionStudy>(`/motion/clips/${encodeURIComponent(clipId)}`, {
    method: "PATCH",
    body: patch,
  });
}

export function deleteMotionClip(clipId: string): Promise<void> {
  return apiRequest<void>(`/motion/clips/${encodeURIComponent(clipId)}`, {
    method: "DELETE",
  });
}

export function retryMotionClip(clipId: string): Promise<MotionStudy> {
  return apiRequest<MotionStudy>(
    `/motion/clips/${encodeURIComponent(clipId)}/retry`,
    { method: "POST", body: {} },
  );
}

export function fetchClipEnergy(clipId: string, signal?: AbortSignal): Promise<ClipEnergy> {
  return apiRequest<ClipEnergy>(`/motion/clips/${encodeURIComponent(clipId)}/energy`, {
    signal: signal ?? null,
  });
}

export function fetchPendingMotion(signal?: AbortSignal): Promise<PendingMotionManifest> {
  return apiRequest<PendingMotionManifest>("/motion/pending", { signal: signal ?? null });
}

export function importMotionAnalyses(
  analyses: readonly unknown[],
  overwriteProtected: boolean,
): Promise<MotionImportReport> {
  return apiRequest<MotionImportReport>("/motion/import", {
    method: "POST",
    body: { analyses, overwriteProtected },
  });
}
