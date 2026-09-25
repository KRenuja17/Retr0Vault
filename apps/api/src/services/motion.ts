import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

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

import type { DatabaseConnection } from "../database/connection.js";
import { motionClips, motionKeyframes, motionStudies, motionStudyTags, references } from "../database/schema.js";
import { ApiError } from "../errors.js";

type StudyRow = typeof motionStudies.$inferSelect;
type ClipRow = typeof motionClips.$inferSelect;

function parseJson<T>(value: string | null, parse: (input: unknown) => T, fallback: T): T {
  if (value === null) return fallback;
  return parse(JSON.parse(value));
}

function studyRowForReference(connection: DatabaseConnection, referenceId: string): StudyRow | undefined {
  return connection.database.select().from(motionStudies).where(eq(motionStudies.referenceId, referenceId)).get();
}

export function assertReferenceExists(connection: DatabaseConnection, referenceId: string): void {
  const row = connection.database.select({ id: references.id }).from(references).where(eq(references.id, referenceId)).get();
  if (row === undefined) throw new ApiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
}

export function findStudyRow(connection: DatabaseConnection, referenceId: string): StudyRow {
  assertReferenceExists(connection, referenceId);
  const row = studyRowForReference(connection, referenceId);
  if (row === undefined) throw new ApiError(404, "MOTION_STUDY_NOT_FOUND", "This reference has no motion study");
  return row;
}

export interface ClipContext {
  readonly clip: ClipRow;
  readonly study: StudyRow;
}

export function findClipContext(connection: DatabaseConnection, clipId: string): ClipContext {
  const clip = connection.database.select().from(motionClips).where(eq(motionClips.id, clipId)).get();
  if (clip === undefined) throw new ApiError(404, "MOTION_CLIP_NOT_FOUND", "Motion clip not found");
  const study = connection.database.select().from(motionStudies).where(eq(motionStudies.id, clip.motionStudyId)).get();
  if (study === undefined) throw new ApiError(404, "MOTION_CLIP_NOT_FOUND", "Motion clip not found");
  return { clip, study };
}

function hydrateStudies(connection: DatabaseConnection, rows: StudyRow[]): MotionStudy[] {
  if (rows.length === 0) return [];
  const studyIds = rows.map((row) => row.id);
  const referenceRows = connection.database.select({
    id: references.id, title: references.title, sourceUrl: references.sourceUrl,
    designTypeId: references.designTypeId, designDNA: references.designDNA,
  }).from(references).where(inArray(references.id, rows.map((row) => row.referenceId))).all();
  const clipRows = connection.database.select().from(motionClips).where(inArray(motionClips.motionStudyId, studyIds))
    .orderBy(asc(motionClips.sortOrder)).all();
  const keyframeRows = clipRows.length === 0 ? [] : connection.database.select().from(motionKeyframes)
    .where(inArray(motionKeyframes.motionClipId, clipRows.map((clip) => clip.id))).orderBy(asc(motionKeyframes.sortOrder)).all();
  const tagRows = connection.database.select().from(motionStudyTags).where(inArray(motionStudyTags.motionStudyId, studyIds))
    .orderBy(asc(motionStudyTags.sortOrder)).all();

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
      protectedFields: motionProtectedFieldsSchema.parse(JSON.parse(row.protectedFields)),
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

export function getMotionStudy(connection: DatabaseConnection, referenceId: string): MotionStudy {
  return hydrateStudies(connection, [findStudyRow(connection, referenceId)])[0]!;
}

export function getMotionStudiesById(connection: DatabaseConnection, studyIds: string[]): MotionStudy[] {
  if (studyIds.length === 0) return [];
  const rows = connection.database.select().from(motionStudies).where(inArray(motionStudies.id, studyIds)).all();
  const studies = hydrateStudies(connection, rows);
  return studyIds.map((id) => studies.find((study) => study.id === id)).filter((study): study is MotionStudy => study !== undefined);
}

/** The small summary carried on reference responses. */
export function motionSummaries(connection: DatabaseConnection, referenceIds: string[]): Map<string, ReferenceMotionSummary> {
  const summaries = new Map<string, ReferenceMotionSummary>();
  if (referenceIds.length === 0) return summaries;
  // Reference reads must keep working on a database migrated only up to 0006
  // (upgrade paths build legacy data with current service code). Not cached, so
  // an in-process upgrade is seen immediately.
  const migrated = connection.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'motion_studies'").get();
  if (migrated === undefined) return summaries;
  const studies = connection.database.select({ id: motionStudies.id, referenceId: motionStudies.referenceId, status: motionStudies.motionStatus })
    .from(motionStudies).where(inArray(motionStudies.referenceId, referenceIds)).all();
  if (studies.length === 0) return summaries;
  const clips = connection.database.select({
    id: motionClips.id, studyId: motionClips.motionStudyId, sortOrder: motionClips.sortOrder,
    status: motionClips.processingStatus, durationMs: motionClips.durationMs,
  }).from(motionClips).where(inArray(motionClips.motionStudyId, studies.map((study) => study.id)))
    .orderBy(asc(motionClips.sortOrder)).all();
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
export function createQueuedClip(connection: DatabaseConnection, input: QueuedClipInput): MotionStudy {
  assertReferenceExists(connection, input.referenceId);
  return connection.database.transaction((transaction) => {
    const now = new Date();
    let study = transaction.select().from(motionStudies).where(eq(motionStudies.referenceId, input.referenceId)).get();
    if (study === undefined) {
      transaction.insert(motionStudies).values({ id: randomUUID(), referenceId: input.referenceId, createdAt: now, updatedAt: now }).run();
      study = transaction.select().from(motionStudies).where(eq(motionStudies.referenceId, input.referenceId)).get()!;
    }
    const existing = transaction.select({ sortOrder: motionClips.sortOrder }).from(motionClips)
      .where(eq(motionClips.motionStudyId, study.id)).all();
    if (existing.length >= maximumMotionClips) {
      throw new ApiError(409, "MOTION_CLIP_LIMIT", `A motion study holds at most ${maximumMotionClips} clips`);
    }
    const used = new Set(existing.map((clip) => clip.sortOrder));
    const sortOrder = [0, 1, 2, 3].find((slot) => !used.has(slot))!;
    transaction.insert(motionClips).values({
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
    }).run();
    transaction.update(motionStudies).set({ updatedAt: now }).where(eq(motionStudies.id, study.id)).run();
    return getMotionStudy(connection, input.referenceId);
  });
}

export function assertClipCapacity(connection: DatabaseConnection, referenceId: string): void {
  assertReferenceExists(connection, referenceId);
  const study = studyRowForReference(connection, referenceId);
  if (study === undefined) return;
  const clips = connection.database.select({ id: motionClips.id }).from(motionClips).where(eq(motionClips.motionStudyId, study.id)).all();
  if (clips.length >= maximumMotionClips) {
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

export function queueEntry(connection: DatabaseConnection, clipId: string): QueueEntry | undefined {
  const row = connection.database.select({
    clipId: motionClips.id, referenceId: motionStudies.referenceId, label: motionClips.label, posterMs: motionClips.posterMs,
    status: motionClips.processingStatus,
  }).from(motionClips).innerJoin(motionStudies, eq(motionClips.motionStudyId, motionStudies.id))
    .where(eq(motionClips.id, clipId)).get();
  if (row === undefined || row.status !== "queued") return undefined;
  return { clipId: row.clipId, referenceId: row.referenceId, label: row.label, posterMs: row.posterMs };
}

/** Clips interrupted mid-run return to the queue; returns every queued clip id, oldest first. */
export function recoverQueue(connection: DatabaseConnection): string[] {
  connection.database.update(motionClips).set({ processingStatus: "queued", updatedAt: new Date() })
    .where(eq(motionClips.processingStatus, "processing")).run();
  return connection.database.select({ id: motionClips.id }).from(motionClips)
    .where(eq(motionClips.processingStatus, "queued")).orderBy(asc(motionClips.createdAt), asc(motionClips.id)).all()
    .map((row) => row.id);
}

export function markClipProcessing(connection: DatabaseConnection, clipId: string): boolean {
  const result = connection.database.update(motionClips)
    .set({ processingStatus: "processing", processingError: null, updatedAt: new Date() })
    .where(and(eq(motionClips.id, clipId), eq(motionClips.processingStatus, "queued"))).run();
  return result.changes === 1;
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
export function completeClip(connection: DatabaseConnection, clipId: string, result: CompletedClip): boolean {
  return connection.database.transaction((transaction) => {
    const clip = transaction.select().from(motionClips).where(eq(motionClips.id, clipId)).get();
    if (clip === undefined) return false;
    const now = new Date();
    transaction.delete(motionKeyframes).where(eq(motionKeyframes.motionClipId, clipId)).run();
    result.keyframes.forEach((keyframe, sortOrder) => {
      transaction.insert(motionKeyframes).values({ id: randomUUID(), motionClipId: clipId, sortOrder, ...keyframe }).run();
    });
    transaction.update(motionClips).set({
      processingStatus: "ready",
      processingError: null,
      sourceFormat: result.sourceFormat,
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
      fps: result.fps,
      bytes: result.bytes,
      posterMs: Math.min(clip.posterMs, result.durationMs),
      evidenceJson: JSON.stringify(clipEvidenceSchema.parse(result.evidence)),
      updatedAt: now,
    }).where(eq(motionClips.id, clipId)).run();
    // New evidence means an analysed study should be looked at again.
    transaction.update(motionStudies).set({ motionStatus: "pending", updatedAt: now })
      .where(and(eq(motionStudies.id, clip.motionStudyId), eq(motionStudies.motionStatus, "analyzed"))).run();
    return true;
  });
}

export function failClip(connection: DatabaseConnection, clipId: string, message: string): void {
  connection.database.update(motionClips).set({ processingStatus: "failed", processingError: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(motionClips.id, clipId)).run();
}

export function requeueClip(connection: DatabaseConnection, clipId: string): ClipContext {
  const context = findClipContext(connection, clipId);
  if (context.clip.processingStatus !== "failed") {
    throw new ApiError(409, "MOTION_CLIP_NOT_FAILED", "Only a failed clip can be retried");
  }
  connection.database.update(motionClips).set({ processingStatus: "queued", processingError: null, updatedAt: new Date() })
    .where(eq(motionClips.id, clipId)).run();
  return context;
}

// ---------------------------------------------------------------------------
// Clip and study edits
// ---------------------------------------------------------------------------

export function updateClip(connection: DatabaseConnection, clipId: string, input: { label?: string | undefined; sortOrder?: number | undefined }): MotionStudy {
  const { clip, study } = findClipContext(connection, clipId);
  connection.database.transaction((transaction) => {
    const now = new Date();
    if (input.label !== undefined) {
      transaction.update(motionClips).set({ label: input.label, updatedAt: now }).where(eq(motionClips.id, clipId)).run();
    }
    if (input.sortOrder !== undefined && input.sortOrder !== clip.sortOrder) {
      const ordered = transaction.select({ id: motionClips.id }).from(motionClips).where(eq(motionClips.motionStudyId, study.id))
        .orderBy(asc(motionClips.sortOrder)).all().map((row) => row.id).filter((id) => id !== clipId);
      ordered.splice(Math.min(input.sortOrder, ordered.length), 0, clipId);
      // Park every row outside the 0–3 range first so the unique index never sees a collision.
      ordered.forEach((id, index) => {
        transaction.update(motionClips).set({ sortOrder: 100 + index }).where(eq(motionClips.id, id)).run();
      });
      ordered.forEach((id, index) => {
        transaction.update(motionClips).set({ sortOrder: index, updatedAt: now }).where(eq(motionClips.id, id)).run();
      });
    }
    transaction.update(motionStudies).set({ updatedAt: now }).where(eq(motionStudies.id, study.id)).run();
  });
  return getMotionStudy(connection, study.referenceId);
}

/** Removes one clip, compacts the order and drops beats that pointed at it. */
export function deleteClipRecord(connection: DatabaseConnection, clipId: string): { referenceId: string; clipId: string } {
  const { study } = findClipContext(connection, clipId);
  connection.database.transaction((transaction) => {
    const now = new Date();
    transaction.delete(motionClips).where(eq(motionClips.id, clipId)).run();
    const remaining = transaction.select({ id: motionClips.id }).from(motionClips).where(eq(motionClips.motionStudyId, study.id))
      .orderBy(asc(motionClips.sortOrder)).all();
    remaining.forEach((row, index) => {
      transaction.update(motionClips).set({ sortOrder: 100 + index }).where(eq(motionClips.id, row.id)).run();
    });
    remaining.forEach((row, index) => {
      transaction.update(motionClips).set({ sortOrder: index }).where(eq(motionClips.id, row.id)).run();
    });
    const beats = parseJson(study.beatsJson, (value) => motionBeatSchema.array().parse(value), []);
    const kept = beats.filter((beat) => beat.clipId !== clipId);
    transaction.update(motionStudies).set({
      beatsJson: study.beatsJson === null ? null : JSON.stringify(kept),
      motionStatus: study.motionStatus === "analyzed" ? "pending" : study.motionStatus,
      updatedAt: now,
    }).where(eq(motionStudies.id, study.id)).run();
  });
  return { referenceId: study.referenceId, clipId };
}

export function deleteStudyRecord(connection: DatabaseConnection, referenceId: string): void {
  const study = findStudyRow(connection, referenceId);
  connection.database.delete(motionStudies).where(eq(motionStudies.id, study.id)).run();
}

export function clipIdsOfReference(connection: DatabaseConnection, referenceId: string): string[] {
  return connection.database.select({ id: motionClips.id }).from(motionClips)
    .innerJoin(motionStudies, eq(motionClips.motionStudyId, motionStudies.id))
    .where(eq(motionStudies.referenceId, referenceId)).all().map((row) => row.id);
}

/** Resolves a ready clip for media serving: its reference id and keyframe/burst counts. */
export function readyClipForMedia(connection: DatabaseConnection, clipId: string): { referenceId: string; keyframeCount: number; burstCount: number } {
  const { clip, study } = findClipContext(connection, clipId);
  if (clip.processingStatus !== "ready") throw new ApiError(404, "MEDIA_NOT_FOUND", "Requested motion media is unavailable");
  const evidence = parseJson(clip.evidenceJson, (value) => clipEvidenceSchema.parse(value), null);
  const keyframeCount = connection.database.select({ id: motionKeyframes.id }).from(motionKeyframes)
    .where(eq(motionKeyframes.motionClipId, clipId)).all().length;
  return { referenceId: study.referenceId, keyframeCount, burstCount: evidence?.bursts.length ?? 0 };
}

/** Clips with a poster available, for serving a poster while a re-run is queued. */
export function clipOwner(connection: DatabaseConnection, clipId: string): { referenceId: string; status: ClipRow["processingStatus"] } {
  const { clip, study } = findClipContext(connection, clipId);
  return { referenceId: study.referenceId, status: clip.processingStatus };
}

/**
 * Studies per beat trigger, in the fixed trigger order. A study counts once per
 * trigger however many of its beats use it; every trigger is listed, even at 0.
 */
export function motionTriggerCounts(connection: DatabaseConnection): Array<{ trigger: MotionTrigger; count: number }> {
  const rows = connection.sqlite.prepare(`
    SELECT json_extract(beat.value, '$.trigger') AS trigger, count(DISTINCT s.id) AS count
    FROM motion_studies s, json_each(CASE WHEN json_valid(s.beats_json) THEN s.beats_json ELSE '[]' END) beat
    GROUP BY 1
  `).all() as Array<{ trigger: string; count: number }>;
  return motionTriggerSchema.options.map((trigger) => ({ trigger, count: rows.find((row) => row.trigger === trigger)?.count ?? 0 }));
}
