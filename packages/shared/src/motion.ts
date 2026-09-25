import { z } from "zod";

import { analysisStatusSchema } from "./references.js";

/*
 * Motion studies: animated recordings attached to an existing reference, and
 * the motion analysis written from their evidence. Design analysis stays on the
 * reference; nothing here overwrites it.
 */

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const observations = z.array(text(2_000)).max(100);

export const maximumMotionClips = 4;
export const maximumMotionDurationMs = 60_000;
export const maximumMotionWidth = 3_840;
export const maximumMotionHeight = 2_160;

export const motionStatusSchema = analysisStatusSchema;
export type MotionStatus = z.infer<typeof motionStatusSchema>;

export const clipProcessingStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type ClipProcessingStatus = z.infer<typeof clipProcessingStatusSchema>;

export const keyframeReasonSchema = z.enum(["start", "onset", "peak", "settle", "cut", "fill", "end"]);
export type KeyframeReason = z.infer<typeof keyframeReasonSchema>;

export const motionTriggerSchema = z.enum([
  "load", "time", "scroll", "wheel", "cursor", "hover", "click", "pinned", "unknown",
]);
export type MotionTrigger = z.infer<typeof motionTriggerSchema>;

export const motionTagTypeSchema = z.enum([
  "trigger", "technique", "transition", "easing", "pacing", "camera", "interaction", "type-motion", "rendering",
]);
export type MotionTagType = z.infer<typeof motionTagTypeSchema>;

export const motionTagInputSchema = z.object({
  type: motionTagTypeSchema,
  value: text(300),
}).strict();
export type MotionTagInput = z.infer<typeof motionTagInputSchema>;

export const motionTagResponseSchema = motionTagInputSchema.extend({
  normalizedValue: z.string().min(1),
  sortOrder: z.number().int().min(0),
}).strict();

export const verifiedTechEntrySchema = z.object({
  claim: text(300),
  source: text(200),
}).strict();
export type VerifiedTechEntry = z.infer<typeof verifiedTechEntrySchema>;

export const verifiedTechSchema = z.array(verifiedTechEntrySchema).max(40);

// ---------------------------------------------------------------------------
// Computed evidence (written by the pipeline, never by an analysis import)
// ---------------------------------------------------------------------------

const unit = z.number().min(0).max(1);

export const motionLocalitySchema = z.enum(["local", "regional", "global"]);

export const motionEventSchema = z.object({
  index: z.number().int().nonnegative(),
  onsetMs: z.number().int().nonnegative(),
  peakMs: z.number().int().nonnegative(),
  settleMs: z.number().int().nonnegative(),
  peakEnergy: unit,
  /** Energy summed over the event, in energy·seconds. */
  integral: z.number().nonnegative(),
  /** Fraction of the 8 × 6 grid cells that changed during the event. */
  spread: unit,
  centroid: z.object({ x: unit, y: unit }).strict(),
  /** Computed hint derived from spread; never a conclusion. */
  locality: motionLocalitySchema,
  /** Rows of the grid that stayed still while others moved (pinned/sticky hint). */
  stillBand: z.object({ fromRow: z.number().int().min(0).max(5), toRow: z.number().int().min(0).max(5) }).strict().nullable(),
}).strict();
export type MotionEvent = z.infer<typeof motionEventSchema>;

export const motionBurstSchema = z.object({
  index: z.number().int().nonnegative(),
  eventIndex: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  frameTimesMs: z.array(z.number().int().nonnegative()).min(2).max(8),
}).strict();
export type MotionBurst = z.infer<typeof motionBurstSchema>;

export const clipEvidenceSchema = z.object({
  sampleFps: z.number().positive(),
  sampleCount: z.number().int().nonnegative(),
  gridColumns: z.literal(8),
  gridRows: z.literal(6),
  threshold: unit,
  /** Mean change across the clip, 0–1. Near zero means a static recording. */
  meanEnergy: unit,
  events: z.array(motionEventSchema).max(200),
  cutsMs: z.array(z.number().int().nonnegative()).max(200),
  bursts: z.array(motionBurstSchema).max(4),
  /** Overall per-cell change, row-major 6 × 8, normalized 0–1. */
  regionTotals: z.array(unit).length(48),
}).strict();
export type ClipEvidence = z.infer<typeof clipEvidenceSchema>;

export const motionKeyframeSchema = z.object({
  index: z.number().int().nonnegative(),
  timeMs: z.number().int().nonnegative(),
  reason: keyframeReasonSchema,
}).strict();
export type MotionKeyframe = z.infer<typeof motionKeyframeSchema>;

export const motionClipSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  sortOrder: z.number().int().nonnegative(),
  processingStatus: clipProcessingStatusSchema,
  processingError: z.string().nullable(),
  sourceFormat: z.string().nullable(),
  posterMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  evidence: clipEvidenceSchema.nullable(),
  keyframes: z.array(motionKeyframeSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export type MotionClip = z.infer<typeof motionClipSchema>;

/** The motion-energy curve, for drawing the scrubber strip. */
export const clipEnergySchema = z.object({
  sampleFps: z.number().positive(),
  energy: z.array(unit).max(10_000),
}).strict();
export type ClipEnergy = z.infer<typeof clipEnergySchema>;

// ---------------------------------------------------------------------------
// Analysis (written by the curator, imported or edited)
// ---------------------------------------------------------------------------

export const motionBeatSchema = z.object({
  clipId: z.uuid(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative().nullable(),
  trigger: motionTriggerSchema,
  label: text(120),
  description: text(2_000),
}).strict().refine((beat) => beat.endMs === null || beat.endMs >= beat.startMs, {
  message: "endMs must not be before startMs",
  path: ["endMs"],
});
export type MotionBeat = z.infer<typeof motionBeatSchema>;

export const implementationClaimSchema = z.object({
  claim: text(500),
  evidence: z.enum(["verified", "inferred"]),
  verifiedTechIndex: z.number().int().nonnegative().nullable(),
}).strict().refine(
  (entry) => entry.evidence === "verified" ? entry.verifiedTechIndex !== null : entry.verifiedTechIndex === null,
  { message: "verified claims must cite verifiedTechIndex; inferred claims must use null", path: ["verifiedTechIndex"] },
);
export type ImplementationClaim = z.infer<typeof implementationClaimSchema>;

export const detailedMotionAnalysisSchema = z.object({
  triggers: observations,
  choreography: observations,
  pacing: observations,
  easing: observations,
  cameraAndSpace: observations,
  typographyMotion: observations,
  imageTreatment: observations,
  interaction: observations,
  performance: observations,
  avoid: observations,
}).strict();
export type DetailedMotionAnalysis = z.infer<typeof detailedMotionAnalysisSchema>;

export const motionAnalysisSchema = z.object({
  referenceId: z.uuid(),
  motionDNA: text(1_000),
  motionThesis: text(5_000),
  techniques: z.array(motionTagInputSchema).max(100),
  beats: z.array(motionBeatSchema).max(200),
  motionBrief: text(20_000),
  implementation: z.array(implementationClaimSchema).max(60),
  analysis: detailedMotionAnalysisSchema,
}).strict();
export type MotionAnalysis = z.infer<typeof motionAnalysisSchema>;

export const motionAnalysisJsonSchema = z.toJSONSchema(motionAnalysisSchema, {
  target: "draft-2020-12",
  io: "input",
});

export const motionProtectedFieldSchema = z.enum([
  "motionDNA", "motionThesis", "motionBrief", "analysis", "beats", "implementation", "techniques",
]);
export type MotionProtectedField = z.infer<typeof motionProtectedFieldSchema>;
export const motionProtectedFieldsSchema = z.array(motionProtectedFieldSchema).max(7)
  .refine((fields) => new Set(fields).size === fields.length, "Protected fields must be unique");

// ---------------------------------------------------------------------------
// Study responses and edits
// ---------------------------------------------------------------------------

export const motionStudySchema = z.object({
  id: z.uuid(),
  referenceId: z.uuid(),
  reference: z.object({
    id: z.uuid(),
    title: z.string(),
    sourceUrl: z.string().nullable(),
    designTypeId: z.uuid().nullable(),
    designDNA: z.string().nullable(),
  }).strict(),
  motionStatus: motionStatusSchema,
  motionDNA: z.string().nullable(),
  motionThesis: z.string().nullable(),
  motionBrief: z.string().nullable(),
  analysis: detailedMotionAnalysisSchema.nullable(),
  beats: z.array(motionBeatSchema),
  implementation: z.array(implementationClaimSchema),
  techniques: z.array(motionTagResponseSchema),
  inspectionNotes: z.string().nullable(),
  verifiedTech: verifiedTechSchema,
  protectedFields: motionProtectedFieldsSchema,
  clips: z.array(motionClipSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export type MotionStudy = z.infer<typeof motionStudySchema>;

export { referenceMotionSummarySchema, type ReferenceMotionSummary } from "./references.js";

const nullableText = (maximum: number) => z.union([z.string().trim().max(maximum), z.null()]);

export const updateMotionStudySchema = z.object({
  motionDNA: nullableText(1_000).optional(),
  motionThesis: nullableText(5_000).optional(),
  motionBrief: nullableText(20_000).optional(),
  analysis: detailedMotionAnalysisSchema.nullable().optional(),
  beats: z.array(motionBeatSchema).max(200).optional(),
  implementation: z.array(implementationClaimSchema).max(60).optional(),
  techniques: z.array(motionTagInputSchema).max(100).optional(),
  inspectionNotes: nullableText(20_000).optional(),
  verifiedTech: verifiedTechSchema.optional(),
  motionStatus: motionStatusSchema.optional(),
  protectedFields: motionProtectedFieldsSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type UpdateMotionStudyInput = z.infer<typeof updateMotionStudySchema>;

export const createMotionClipFieldsSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  posterMs: z.coerce.number().int().min(0).max(maximumMotionDurationMs).default(1_000),
}).strict();
export type CreateMotionClipFields = z.infer<typeof createMotionClipFieldsSchema>;

export const updateMotionClipSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().min(0).max(maximumMotionClips - 1).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type UpdateMotionClipInput = z.infer<typeof updateMotionClipSchema>;

// ---------------------------------------------------------------------------
// Motion section listing
// ---------------------------------------------------------------------------

export const motionListQuerySchema = z.object({
  q: z.string().trim().max(500).optional(),
  trigger: motionTriggerSchema.optional(),
  technique: z.string().trim().min(1).max(300).optional(),
  status: motionStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(["relevance", "newest", "oldest", "title-asc", "title-desc"]).optional(),
  includeCatalogueIndex: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
}).strict().transform((value) => ({ ...value, sort: value.sort ?? (value.q ? "relevance" : "newest") }));
export type MotionListQuery = z.infer<typeof motionListQuerySchema>;

export const motionListItemSchema = z.object({
  studyId: z.uuid(),
  referenceId: z.uuid(),
  title: z.string(),
  sourceUrl: z.string().nullable(),
  designTypeId: z.uuid().nullable(),
  motionStatus: motionStatusSchema,
  motionDNA: z.string().nullable(),
  techniques: z.array(motionTagResponseSchema),
  triggers: z.array(motionTriggerSchema),
  clipCount: z.number().int().nonnegative(),
  primaryClip: z.object({
    id: z.uuid(),
    label: z.string(),
    processingStatus: clipProcessingStatusSchema,
    durationMs: z.number().int().nonnegative().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    keyframeCount: z.number().int().nonnegative(),
  }).strict().nullable(),
  catalogueIndex: z.number().int().positive().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export type MotionListItem = z.infer<typeof motionListItemSchema>;

export const motionListResponseSchema = z.object({
  items: z.array(motionListItemSchema),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  countsByTrigger: z.array(z.object({ trigger: motionTriggerSchema, count: z.number().int().nonnegative() }).strict()),
}).strict();
export type MotionListResponse = z.infer<typeof motionListResponseSchema>;

// ---------------------------------------------------------------------------
// Curator workflow
// ---------------------------------------------------------------------------

export const motionImportRequestSchema = z.object({
  analyses: z.array(z.unknown()).min(1).max(100),
  overwriteProtected: z.boolean().default(false),
}).strict();

export const motionImportResultSchema = z.object({
  source: z.string(),
  referenceId: z.uuid().nullable(),
  status: z.enum(["imported", "failed"]),
  preservedFields: motionProtectedFieldsSchema,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
}).strict();
export type MotionImportResult = z.infer<typeof motionImportResultSchema>;

export const motionImportReportSchema = z.object({
  imported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  results: z.array(motionImportResultSchema),
}).strict();
export type MotionImportReport = z.infer<typeof motionImportReportSchema>;

const manifestClipSchema = z.object({
  clipId: z.uuid(),
  label: z.string(),
  durationMs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  clipPath: z.string(),
  posterPath: z.string(),
  contactSheetPath: z.string(),
  energyTimelinePath: z.string(),
  regionSheetPath: z.string(),
  keyframes: z.array(motionKeyframeSchema.extend({ imagePath: z.string() })),
  bursts: z.array(motionBurstSchema.extend({ imagePath: z.string() })),
  evidence: clipEvidenceSchema,
}).strict();

export const pendingMotionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  resultsDirectory: z.string(),
  analysisSchema: z.record(z.string(), z.unknown()),
  studies: z.array(z.object({
    referenceId: z.uuid(),
    title: z.string(),
    sourceUrl: z.string().nullable(),
    designContext: z.object({ designDNA: z.string().nullable(), designThesis: z.string().nullable() }).strict(),
    inspectionNotes: z.string().nullable(),
    verifiedTech: z.array(verifiedTechEntrySchema.extend({ index: z.number().int().nonnegative() })),
    protectedFields: motionProtectedFieldsSchema,
    clips: z.array(manifestClipSchema),
  }).strict()),
  unavailable: z.array(z.object({ referenceId: z.uuid(), message: z.string() }).strict()),
}).strict();
export type PendingMotionManifest = z.infer<typeof pendingMotionManifestSchema>;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const motionStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  analyzed: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
}).strict();
