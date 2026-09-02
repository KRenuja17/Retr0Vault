import type {
  CollectionResponse,
  DesignTypeResponse,
  ReferenceResponse,
  StatsResponse,
} from "@retr0vault/shared";

import type { CatalogueReference } from "./ReferenceCard";

/* Test-only builders shaped exactly like the backend responses. */

const NOW = "2026-09-02T09:00:00.000Z";

export function makeDesignType(
  overrides: Partial<DesignTypeResponse> & Pick<DesignTypeResponse, "id" | "slug" | "name">,
): DesignTypeResponse {
  return {
    description: "A design type.",
    deployFor: "Portfolios and agencies.",
    risk: "Push it too far.",
    briefBlock: "Brief block.",
    sortOrder: 0,
    principles: [],
    avoid: [],
    vocabulary: [],
    referenceCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeCollection(
  overrides: Partial<CollectionResponse> & Pick<CollectionResponse, "id" | "slug" | "name">,
): CollectionResponse {
  return {
    description: "",
    isPinned: true,
    sortOrder: 0,
    referenceCount: 0,
    ...overrides,
  };
}

export function makeReference(
  overrides: Partial<CatalogueReference> & Pick<ReferenceResponse, "id" | "title">,
): CatalogueReference {
  return {
    sourceType: "image",
    sourceUrl: null,
    originalPath: "originals/should-never-be-used.png",
    thumbnailPath: "thumbnails/should-never-be-used.webp",
    designTypeId: null,
    designDNA: null,
    designThesis: null,
    designBrief: null,
    imageRecipe: null,
    motionBrief: null,
    assetBrief: null,
    analysisStatus: "analyzed",
    analysisJson: null,
    protectedFields: [],
    image: { width: 1600, height: 1000, format: "png" },
    tags: [],
    collectionIds: [],
    frames: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeTag(value: string, sortOrder: number) {
  return {
    id: `00000000-0000-4000-8000-${String(sortOrder).padStart(12, "0")}`,
    type: "imagery",
    value,
    normalizedValue: value.toLowerCase(),
    sortOrder,
  };
}

export function makeStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    totalReferences: 0,
    pendingReferences: 0,
    analyzedReferences: 0,
    unassignedReferences: 0,
    countsByDesignType: [],
    countsByCollection: [],
    ...overrides,
  };
}
