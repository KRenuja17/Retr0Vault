import type { ClipEvidence, MotionClip, MotionListItem, MotionListResponse, MotionStudy } from "@retr0vault/shared";

/* Test fixtures for the Motion section, shaped exactly like the API's responses. */

const NOW = "2026-09-25T12:00:00.000Z";

export const REFERENCE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
export const HERO_CLIP = "cccccccc-0000-4000-8000-000000000001";
export const SCROLL_CLIP = "cccccccc-0000-4000-8000-000000000002";

export function makeEvidence(overrides: Partial<ClipEvidence> = {}): ClipEvidence {
  return {
    sampleFps: 10,
    sampleCount: 150,
    gridColumns: 8,
    gridRows: 6,
    threshold: 0.012,
    meanEnergy: 0.04,
    events: [{
      index: 0, onsetMs: 9_300, peakMs: 9_600, settleMs: 14_600, peakEnergy: 0.3, integral: 0.4,
      spread: 0.17, centroid: { x: 0.5, y: 0.3 }, locality: "local", stillBand: null,
    }],
    cutsMs: [1_600],
    bursts: [{ index: 0, eventIndex: 0, startMs: 9_200, endMs: 14_600, frameTimesMs: [9_200, 10_000, 11_000, 12_000, 13_000, 14_000, 14_300, 14_600] }],
    regionTotals: new Array(48).fill(0.2),
    ...overrides,
  };
}

export function makeClip(overrides: Partial<MotionClip> & Pick<MotionClip, "id" | "label">): MotionClip {
  return {
    sortOrder: 0,
    processingStatus: "ready",
    processingError: null,
    sourceFormat: "matroska/vp8",
    posterMs: 1_000,
    durationMs: 15_000,
    width: 1280,
    height: 800,
    fps: 25,
    bytes: 2_000_000,
    evidence: makeEvidence(),
    keyframes: [
      { index: 0, timeMs: 0, reason: "start" },
      { index: 1, timeMs: 9_300, reason: "onset" },
      { index: 2, timeMs: 14_900, reason: "end" },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeStudy(overrides: Partial<MotionStudy> = {}): MotionStudy {
  return {
    id: "dddddddd-0000-4000-8000-000000000001",
    referenceId: REFERENCE_ID,
    reference: { id: REFERENCE_ID, title: "Lando Norris", sourceUrl: "https://landonorris.com/", designTypeId: null, designDNA: "racing scrapbook" },
    motionStatus: "analyzed",
    motionDNA: "cursor-painted livery × block-wipe scroll",
    motionThesis: "The hero paints the helmet onto the portrait along the cursor.",
    motionBrief: "Tie the hero effect to the cursor path.",
    analysis: {
      triggers: ["cursor drives the hero"], choreography: [], pacing: ["one chapter per viewport"], easing: [],
      cameraAndSpace: [], typographyMotion: [], imageTreatment: [], interaction: [], performance: [], avoid: ["autoplaying the hero"],
    },
    beats: [
      { clipId: HERO_CLIP, startMs: 9_300, endMs: 14_600, trigger: "cursor", label: "Livery sweep", description: "The visor band follows the cursor." },
      { clipId: SCROLL_CLIP, startMs: 4_000, endMs: null, trigger: "scroll", label: "Chapter wipe", description: "A block wipe reveals the headline." },
    ],
    implementation: [
      { claim: "Smooth scrolling via Lenis", evidence: "verified", verifiedTechIndex: 0 },
      { claim: "Wipes are clip-path transitions", evidence: "inferred", verifiedTechIndex: null },
    ],
    techniques: [
      { type: "interaction", value: "cursor-trail livery reveal", normalizedValue: "cursor-trail livery reveal", sortOrder: 0 },
      { type: "transition", value: "block-wipe reveal", normalizedValue: "block-wipe reveal", sortOrder: 1 },
    ],
    inspectionNotes: "Helmet livery follows the cursor.",
    verifiedTech: [{ claim: "html.lenis class present", source: "DevTools" }],
    protectedFields: [],
    clips: [
      makeClip({ id: HERO_CLIP, label: "Hero cursor", sortOrder: 0 }),
      makeClip({ id: SCROLL_CLIP, label: "Scroll journey", sortOrder: 1, durationMs: 20_000 }),
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeListItem(overrides: Partial<MotionListItem> = {}): MotionListItem {
  return {
    studyId: "dddddddd-0000-4000-8000-000000000001",
    referenceId: REFERENCE_ID,
    title: "Lando Norris",
    sourceUrl: "https://landonorris.com/",
    designTypeId: null,
    motionStatus: "analyzed",
    motionDNA: "cursor-painted livery × block-wipe scroll",
    techniques: makeStudy().techniques,
    triggers: ["scroll", "cursor"],
    clipCount: 2,
    primaryClip: { id: HERO_CLIP, label: "Hero cursor", processingStatus: "ready", durationMs: 15_000, width: 1280, height: 800, keyframeCount: 3 },
    catalogueIndex: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function motionPage(items: readonly MotionListItem[], counts: Partial<Record<string, number>> = {}): MotionListResponse {
  return {
    items: [...items],
    page: 1,
    limit: 24,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    countsByTrigger: (["load", "time", "scroll", "wheel", "cursor", "hover", "click", "pinned", "unknown"] as const)
      .map((trigger) => ({ trigger, count: counts[trigger] ?? 0 })),
  };
}
