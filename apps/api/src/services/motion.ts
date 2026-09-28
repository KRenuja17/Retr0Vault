import { randomUUID } from "node:crypto";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import {
  clipEvidenceSchema,
  detailedMotionAnalysisSchema,
  implementationClaimSchema,
  maximumMotionClips,
  motionBeatSchema,
  motionProtectedFieldsSchema,
  motionStudySchema,
  motionTriggerSchema,
  referenceMotionSummarySchema,
  verifiedTechSchema,
  type ClipEvidence,
  type KeyframeReason,
  type MotionStudy,
  type MotionTrigger,
  type ReferenceMotionSummary,
} from "@retr0vault/shared";

import { rowsOf, type Db } from "../database/connection.js";
import { renumber } from "../database/ordering.js";
import { motionClips, motionKeyframes, motionStudies, motionStudyTags, references } from "../database/schema.js";
import { ApiError } from "../errors.js";

type StudyRow = typeof motionStudies.$inferSelect;
type ClipRow = typeof motionClips.$inferSelect;

function parseJson<T>(value: unknown, parse: (input: unknown) => T, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return parse(value);
}

async function studyRowForReference(db: Db, referenceId: string): Promise<StudyRow | undefined> {
  const [row] = await db.select().from(motionStudies).where(eq(motionStudies.referenceId, referenceId));
  return row;
}

export async function assertReferenceExists(db: Db, referenceId: string): Promise<void> {
  const [row] = await db.select({ id: references.id }).from(references).where(eq(references.id, referenceId));
  if (row === undefined) throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
}

export async function findStudyRow(db: Db, referenceId: string): Promise<StudyRow> {
  await assertReferenceExists(db, referenceId);
  const row = await studyRowForReference(db, referenceId);
  if (row === undefined) throw new ApiError(404, "MOTION_STUDY_NOT_FOUND", "This reference has no motion study");
  return row;
}

export interface ClipContext {
  readonly clip: ClipRow;
  readonly study: StudyRow;
}

export async function findClipContext(db: Db, clipId: string): Promise<ClipContext> {
  const [row] = await db.select({ clip: motionClips, study: motionStudies }).from(motionClips)
    .innerJoin(motionStudies, eq(motionClips.motionStudyId, motionStudies.id))
    .where(eq(motionClips.id, clipId));
  if (row === undefined) throw new ApiError(404, "MOTION_CLIP_NOT_FOUND", "Motion clip not found");
  return row;
}

async function hydrateStudies(db: Db, rows: StudyRow[]): Promise<MotionStudy[]> {
  if (rows.length === 0) return [];
  const studyIds = rows.map((row) => row.id);
  const [referenceRows, clipRows, tagRows] = await Promise.all([
    db.select({
      id: references.id, title: references.title, sourceUrl: references.sourceUrl,
      designTypeId: references.designTypeId, designDNA: references.designDNA,
    }).from(references).where(inArray(references.id, rows.map((row) => row.referenceId))),
    db.select().from(motionClips).where(inArray(motionClips.motionStudyId, studyIds)).orderBy(asc(motionClips.sortOrder)),
    db.select().from(motionStudyTags).where(inArray(motionStudyTags.motionStudyId, studyIds)).orderBy(asc(motionStudyTags.sortOrder)),
  ]);
  const keyframeRows = clipRows.length === 0 ? [] : await db.select().from(motionKeyframes)
    .where(inArray(motionKeyframes.motionClipId, clipRows.map((clip) => clip.id))).orderBy(asc(motionKeyframes.sortOrder));

  return rows.map((row) => {
    const reference = referenceRows.find((candidate) => candidate.id === row.referenceId);
    if (reference === undefined) throw new Error("Motion study without a reference");
    return motionStudySchema.parse({
      id: row.id,
      referenceId: row.referenceId,
      reference,
      motionStatus: row.motionStatus,
      motionDNA: row.motionDNA,
      motionThesis: row.motionThesis,
      motionBrief: row.motionBrief,
      analysis: parseJson(row.motionAnalysisJson, (value) => detailedMotionAnalysisSchema.parse(value), null),
      beats: parseJson(row.beatsJson, (value) => motionBeatSchema.array().parse(value), []),
      implementation: parseJson(row.implementationJson, (value) => implementationClaimSchema.array().parse(value), []),
      techniques: tagRows.filter((tag) => tag.motionStudyId === row.id).map((tag) => ({
        type: tag.type, value: tag.value, normalizedValue: tag.normalizedValue, sortOrder: tag.sortOrder,
      })),
      inspectionNotes: row.inspectionNotes,
      verifiedTech: parseJson(row.verifiedTechJson, (value) => verifiedTechSchema.parse(value), []),
      protectedFields: motionProtectedFieldsSchema.parse(row.protectedFields),
      clips: clipRows.filter((clip) => clip.motionStudyId === row.id).map((clip) => ({
        id: clip.id,
        label: clip.label,
        sortOrder: clip.sortOrder,
        processingStatus: clip.processingStatus,
        processingError: clip.processingError,
        sourceFormat: clip.sourceFormat,
        posterMs: clip.posterMs,
        durationMs: clip.durationMs,
        width: clip.width,
        height: clip.height,
        fps: clip.fps,
        bytes: clip.bytes,
        evidence: parseJson(clip.evidenceJson, (value) => clipEvidenceSchema.parse(value), null),
        keyframes: keyframeRows.filter((keyframe) => keyframe.motionClipId === clip.id)
          .map((keyframe) => ({ index: keyframe.sortOrder, timeMs: keyframe.timeMs, reason: keyframe.reason })),
        createdAt: clip.createdAt.toISOString(),
        updatedAt: clip.updatedAt.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  });
}

export async function getMotionStudy(db: Db, referenceId: string): Promise<MotionStudy> {
  return (await hydrateStudies(db, [await findStudyRow(db, referenceId)]))[0]!;
}

export async function getMotionStudiesById(db: Db, studyIds: string[]): Promise<MotionStudy[]> {
  if (studyIds.length === 0) return [];
  const rows = await db.select().from(motionStudies).where(inArray(motionStudies.id, studyIds));
  const studies = await hydrateStudies(db, rows);
  return studyIds.map((id) => studies.find((study) => study.id === id)).filter((study): study is MotionStudy => study !== undefined);
}

/** The small summary carried on reference responses. */
export async function motionSummaries(db: Db, referenceIds: string[]): Promise<Map<string, ReferenceMotionSummary>> {
  const summaries = new Map<string, ReferenceMotionSummary>();
  if (referenceIds.length === 0) return summaries;
  const studies = await db.select({ id: motionStudies.id, referenceId: motionStudies.referenceId, status: motionStudies.motionStatus })
    .from(motionStudies).where(inArray(motionStudies.referenceId, referenceIds));
  if (studies.length === 0) return summaries;
  const clips = await db.select({
    id: motionClips.id, studyId: motionClips.motionStudyId, sortOrder: motionClips.sortOrder,
    status: motionClips.processingStatus, durationMs: motionClips.durationMs,
  }).from(motionClips).where(inArray(motionClips.motionStudyId, studies.map((study) => study.id)))
    .orderBy(asc(motionClips.sortOrder));
  for (const study of studies) {
    const own = clips.filter((clip) => clip.studyId === study.id);
    const primary = own[0];
    summaries.set(study.referenceId, referenceMotionSummarySchema.parse({
      studyId: study.id,
      status: study.status,
      clipCount: own.length,
      readyClipCount: own.filter((clip) => clip.status === "ready").length,
      primaryClipId: primary?.id ?? null,
      durationMs: primary?.durationMs ?? null,
      previewClipId: own.find((clip) => clip.status === "ready")?.id ?? null,
    }));
  }
  return summaries;
}

export interface QueuedClipInput {
  readonly referenceId: string;
  readonly clipId: string;
  readonly label: string | undefined;
  readonly posterMs: number;
  readonly sourceFormat: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

/** Creates the study on the first clip, then a queued clip in the next free slot. */
export async function createQueuedClip(db: Db, input: QueuedClipInput): Promise<MotionStudy> {
  await assertReferenceExists(db, input.referenceId);
  return db.transaction(async (transaction) => {
    const now = new Date();
    await transaction.insert(motionStudies)
      .values({ id: randomUUID(), referenceId: input.referenceId, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: motionStudies.referenceId });
    // Lock the study row so two uploads to one study pick different slots.
    const [study] = await transaction.select().from(motionStudies)
      .where(eq(motionStudies.referenceId, input.referenceId)).for("update");
    if (study === undefined) throw new Error("Motion study could not be created");
    const existing = await transaction.select({ sortOrder: motionClips.sortOrder }).from(motionClips)
      .where(eq(motionClips.motionStudyId, study.id));
    if (existing.length >= maximumMotionClips) {
      throw new ApiError(409, "MOTION_CLIP_LIMIT", `A motion study holds at most ${maximumMotionClips} clips`);
    }
    const used = new Set(existing.map((clip) => clip.sortOrder));
    const sortOrder = [0, 1, 2, 3].find((slot) => !used.has(slot))!;
    await transaction.insert(motionClips).values({
      id: input.clipId,
      motionStudyId: study.id,
      label: input.label ?? (sortOrder === 0 ? "Primary" : `Clip ${sortOrder + 1}`),
      sortOrder,
      processingStatus: "queued",
      sourceFormat: input.sourceFormat,
      posterMs: Math.min(input.posterMs, input.durationMs),
      durationMs: input.durationMs,
      width: input.width,
      height: input.height,
      fps: input.fps,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.update(motionStudies).set({ updatedAt: now }).where(eq(motionStudies.id, study.id));
    return getMotionStudy(transaction, input.referenceId);
  });
}

export async function assertClipCapacity(db: Db, referenceId: string): Promise<void> {
  await assertReferenceExists(db, referenceId);
  const study = await studyRowForReference(db, referenceId);
  if (study === undefined) return;
  const [row] = await db.select({ value: count() }).from(motionClips).where(eq(motionClips.motionStudyId, study.id));
  if ((row?.value ?? 0) >= maximumMotionClips) {
    throw new ApiError(409, "MOTION_CLIP_LIMIT", `A motion study holds at most ${maximumMotionClips} clips`);
  }
}

// ---------------------------------------------------------------------------
// Processing bookkeeping (used by the queue)
// ---------------------------------------------------------------------------

export interface QueueEntry {
  readonly clipId: string;
  readonly referenceId: string;
  readonly label: string;
  readonly posterMs: number;
}

/** Clips interrupted mid-run return to the queue; returns every queued clip id, oldest first. */
export async function recoverQueue(db: Db): Promise<string[]> {
  await db.update(motionClips).set({ processingStatus: "queued", updatedAt: new Date() })
    .where(eq(motionClips.processingStatus, "processing"));
  const rows = await db.select({ id: motionClips.id }).from(motionClips)
    .where(eq(motionClips.processingStatus, "queued")).orderBy(asc(motionClips.createdAt), asc(motionClips.id));
  return rows.map((row) => row.id);
}

/**
 * Claims a queued clip for processing: one statement moves it from `queued` to
 * `processing`, so of two workers asking for the same clip exactly one gets it.
 */
export async function claimClip(db: Db, clipId: string): Promise<QueueEntry | undefined> {
  const [claimed] = await db.update(motionClips)
    .set({ processingStatus: "processing", processingError: null, updatedAt: new Date() })
    .where(and(eq(motionClips.id, clipId), eq(motionClips.processingStatus, "queued")))
    .returning({ clipId: motionClips.id, studyId: motionClips.motionStudyId, label: motionClips.label, posterMs: motionClips.posterMs });
  if (claimed === undefined) return undefined;
  const [study] = await db.select({ referenceId: motionStudies.referenceId }).from(motionStudies)
    .where(eq(motionStudies.id, claimed.studyId));
  if (study === undefined) return undefined;
  return { clipId: claimed.clipId, referenceId: study.referenceId, label: claimed.label, posterMs: claimed.posterMs };
}

export interface CompletedClip {
  readonly sourceFormat: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bytes: number;
  readonly evidence: ClipEvidence;
  readonly keyframes: ReadonlyArray<{ timeMs: number; reason: KeyframeReason; imagePath: string }>;
}

/** Stores the evidence and keyframes; returns false if the clip vanished meanwhile. */
export async function completeClip(db: Db, clipId: string, result: CompletedClip): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const [clip] = await transaction.select().from(motionClips).where(eq(motionClips.id, clipId)).for("update");
    if (clip === undefined) return false;
    const now = new Date();
    await transaction.delete(motionKeyframes).where(eq(motionKeyframes.motionClipId, clipId));
    if (result.keyframes.length > 0) {
      await transaction.insert(motionKeyframes).values(result.keyframes.map((keyframe, sortOrder) => ({
        id: randomUUID(), motionClipId: clipId, sortOrder, ...keyframe,
      })));
    }
    await transaction.update(motionClips).set({
      processingStatus: "ready",
      processingError: null,
      sourceFormat: result.sourceFormat,
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
      fps: result.fps,
      bytes: result.bytes,
      posterMs: Math.min(clip.posterMs, result.durationMs),
      evidenceJson: clipEvidenceSchema.parse(result.evidence),
      updatedAt: now,
    }).where(eq(motionClips.id, clipId));
    // New evidence means an analysed study should be looked at again.
    await transaction.update(motionStudies).set({ motionStatus: "pending", updatedAt: now })
      .where(and(eq(motionStudies.id, clip.motionStudyId), eq(motionStudies.motionStatus, "analyzed")));
    return true;
  });
}

export async function failClip(db: Db, clipId: string, message: string): Promise<void> {
  await db.update(motionClips).set({ processingStatus: "failed", processingError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(motionClips.id, clipId));
}

export async function requeueClip(db: Db, clipId: string): Promise<ClipContext> {
  const context = await findClipContext(db, clipId);
  if (context.clip.processingStatus !== "failed") {
    throw new ApiError(409, "MOTION_CLIP_NOT_FAILED", "Only a failed clip can be retried");
  }
  await db.update(motionClips).set({ processingStatus: "queued", processingError: null, updatedAt: new Date() })
    .where(eq(motionClips.id, clipId));
  return context;
}

// ---------------------------------------------------------------------------
// Clip and study edits
// ---------------------------------------------------------------------------

function renumberClips(db: Db, studyId: string, clipIds: readonly string[]): Promise<void> {
  return renumber(db, motionClips, motionClips.id, clipIds, sql`${motionClips.motionStudyId} = ${studyId}::uuid`);
}

export async function updateClip(
  db: Db,
  clipId: string,
  input: { label?: string | undefined; sortOrder?: number | undefined },
): Promise<MotionStudy> {
  const { clip, study } = await findClipContext(db, clipId);
  await db.transaction(async (transaction) => {
    const now = new Date();
    if (input.label !== undefined) {
      await transaction.update(motionClips).set({ label: input.label, updatedAt: now }).where(eq(motionClips.id, clipId));
    }
    if (input.sortOrder !== undefined && input.sortOrder !== clip.sortOrder) {
      const ordered = (await transaction.select({ id: motionClips.id }).from(motionClips).where(eq(motionClips.motionStudyId, study.id))
        .orderBy(asc(motionClips.sortOrder))).map((row) => row.id).filter((id) => id !== clipId);
      ordered.splice(Math.min(input.sortOrder, ordered.length), 0, clipId);
      await renumberClips(transaction, study.id, ordered);
      await transaction.update(motionClips).set({ updatedAt: now }).where(inArray(motionClips.id, ordered));
    }
    await transaction.update(motionStudies).set({ updatedAt: now }).where(eq(motionStudies.id, study.id));
  });
  return getMotionStudy(db, study.referenceId);
}

/** Removes one clip, compacts the order and drops beats that pointed at it. */
export async function deleteClipRecord(db: Db, clipId: string): Promise<{ referenceId: string; clipId: string }> {
  const { study } = await findClipContext(db, clipId);
  await db.transaction(async (transaction) => {
    const now = new Date();
    await transaction.delete(motionClips).where(eq(motionClips.id, clipId));
    const remaining = await transaction.select({ id: motionClips.id }).from(motionClips).where(eq(motionClips.motionStudyId, study.id))
      .orderBy(asc(motionClips.sortOrder));
    await renumberClips(transaction, study.id, remaining.map((row) => row.id));
    const beats = parseJson(study.beatsJson, (value) => motionBeatSchema.array().parse(value), []);
    const kept = beats.filter((beat) => beat.clipId !== clipId);
    await transaction.update(motionStudies).set({
      beatsJson: study.beatsJson === null ? null : kept,
      motionStatus: study.motionStatus === "analyzed" ? "pending" : study.motionStatus,
      updatedAt: now,
    }).where(eq(motionStudies.id, study.id));
  });
  return { referenceId: study.referenceId, clipId };
}

export async function deleteStudyRecord(db: Db, referenceId: string): Promise<void> {
  const study = await findStudyRow(db, referenceId);
  await db.delete(motionStudies).where(eq(motionStudies.id, study.id));
}

export async function clipIdsOfReference(db: Db, referenceId: string): Promise<string[]> {
  const rows = await db.select({ id: motionClips.id }).from(motionClips)
    .innerJoin(motionStudies, eq(motionClips.motionStudyId, motionStudies.id))
    .where(eq(motionStudies.referenceId, referenceId));
  return rows.map((row) => row.id);
}

/** Resolves a ready clip for media serving: its reference id and keyframe/burst counts. */
export async function readyClipForMedia(db: Db, clipId: string): Promise<{ referenceId: string; keyframeCount: number; burstCount: number }> {
  const { clip, study } = await findClipContext(db, clipId);
  if (clip.processingStatus !== "ready") throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
  const evidence = parseJson(clip.evidenceJson, (value) => clipEvidenceSchema.parse(value), null);
  const [keyframes] = await db.select({ value: count() }).from(motionKeyframes).where(eq(motionKeyframes.motionClipId, clipId));
  return { referenceId: study.referenceId, keyframeCount: keyframes?.value ?? 0, burstCount: evidence?.bursts.length ?? 0 };
}

/** Clips with a poster available, for serving a poster while a re-run is queued. */
export async function clipOwner(db: Db, clipId: string): Promise<{ referenceId: string; status: ClipRow["processingStatus"] }> {
  const { clip, study } = await findClipContext(db, clipId);
  return { referenceId: study.referenceId, status: clip.processingStatus };
}

/**
 * Studies per beat trigger, in the fixed trigger order. A study counts once per
 * trigger however many of its beats use it; every trigger is listed, even at 0.
 */
export async function motionTriggerCounts(db: Db): Promise<Array<{ trigger: MotionTrigger; count: number }>> {
  const rows = rowsOf<{ trigger: string; count: number | string }>(await db.execute(sql`
    select beat ->> 'trigger' as trigger, count(distinct s.id)::integer as count
    from motion_studies s,
      jsonb_array_elements(case when jsonb_typeof(s.beats_json) = 'array' then s.beats_json else '[]'::jsonb end) as beat
    group by 1
  `));
  return motionTriggerSchema.options.map((trigger) => ({
    trigger,
    count: Number(rows.find((row) => row.trigger === trigger)?.count ?? 0),
  }));
}
