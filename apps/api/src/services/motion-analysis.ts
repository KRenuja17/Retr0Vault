import { resolve } from "node:path";

import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  clipEvidenceSchema,
  motionAnalysisJsonSchema,
  motionAnalysisSchema,
  motionImportReportSchema,
  motionListResponseSchema,
  motionProtectedFieldSchema,
  motionProtectedFieldsSchema,
  motionTriggerSchema,
  motionBeatSchema,
  pendingMotionManifestSchema,
  updateMotionStudySchema,
  type MotionBeat,
  type ImplementationClaim,
  type MotionImportReport,
  type MotionImportResult,
  type MotionListQuery,
  type MotionListResponse,
  type MotionStudy,
  type MotionTagInput,
  type MotionTrigger,
  type PendingMotionManifest,
  type UpdateMotionStudyInput,
  type VerifiedTechEntry,
} from "@retr0vault/shared";

import type { DatabaseConnection } from "../database/connection.js";
import { motionClips, motionKeyframes, motionStudies, motionStudyTags, references } from "../database/schema.js";
import { ApiError } from "../errors.js";
import { burstFileName, type MotionStorage } from "../storage/motion-storage.js";
import { findStudyRow, getMotionStudy, motionTriggerCounts } from "./motion.js";
import { referenceSearchExpression } from "./reference-search.js";

/*
 * Motion analysis: edits, the curator export/import, and the Motion section
 * listing. Evidence (clips, keyframes, energy) is written only by the pipeline;
 * inspection notes and verified tech only by explicit edits, never by an import.
 */

// Column order is defined by 0008_motion_search.sql.
export const motionSearchRank = sql`bm25(motion_search, 0, 10, 12, 8, 6, 4, 2, 2, 1)`;

function normalizeTechniques(input: readonly MotionTagInput[]): Array<MotionTagInput & { normalizedValue: string }> {
  const seen = new Set<string>();
  return input.map((tag) => {
    const normalizedValue = tag.value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    const key = `${tag.type}\u0000${normalizedValue}`;
    if (seen.has(key)) throw new ApiError(400, "VALIDATION_ERROR", "techniques: Technique type/value combinations must be unique");
    seen.add(key);
    return { type: tag.type, value: tag.value, normalizedValue };
  });
}

/** Beats must point at a ready clip of this study, fall inside it, and be sorted by clip order then start. */
function assertBeats(study: MotionStudy, beats: readonly MotionBeat[]): void {
  let previous: [number, number] = [-1, -1];
  for (const [index, beat] of beats.entries()) {
    const order = study.clips.findIndex((candidate) => candidate.id === beat.clipId);
    const clip = study.clips[order];
    if (clip === undefined || clip.processingStatus !== "ready" || clip.durationMs === null) {
      throw new ApiError(400, "INVALID_BEAT", `beats.${index}: clipId must be a processed clip of this study`);
    }
    if (beat.startMs > clip.durationMs || (beat.endMs !== null && beat.endMs > clip.durationMs + 50)) {
      throw new ApiError(400, "INVALID_BEAT", `beats.${index}: times must fall within the clip (${clip.durationMs} ms)`);
    }
    if (order < previous[0] || (order === previous[0] && beat.startMs < previous[1])) {
      throw new ApiError(400, "INVALID_BEAT", `beats.${index}: beats must be sorted by clip order, then start time`);
    }
    previous = [order, beat.startMs];
  }
}

/** A verified claim must cite an existing verified-tech entry. */
function assertImplementation(claims: readonly ImplementationClaim[], verifiedTech: readonly VerifiedTechEntry[]): void {
  for (const [index, claim] of claims.entries()) {
    if (claim.evidence === "verified" && (claim.verifiedTechIndex === null || claim.verifiedTechIndex >= verifiedTech.length)) {
      throw new ApiError(400, "UNVERIFIED_IMPLEMENTATION",
        `implementation.${index}: a verified claim must cite an existing verifiedTech entry (0–${verifiedTech.length - 1})`);
    }
  }
}

export function updateMotionStudy(
  connection: DatabaseConnection,
  referenceId: string,
  input: UpdateMotionStudyInput,
  options: { readonly protectEditedFields?: boolean } = {},
): MotionStudy {
  const row = findStudyRow(connection, referenceId);
  const current = getMotionStudy(connection, referenceId);
  if (input.beats !== undefined) assertBeats(current, input.beats);
  assertImplementation(input.implementation ?? current.implementation, input.verifiedTech ?? current.verifiedTech);
  const techniques = input.techniques === undefined ? undefined : normalizeTechniques(input.techniques);

  connection.database.transaction((transaction) => {
    const existing = motionProtectedFieldsSchema.parse(JSON.parse(row.protectedFields));
    const edited = options.protectEditedFields === false ? [] :
      motionProtectedFieldSchema.options.filter((field) => input[field] !== undefined);
    const protections = input.protectedFields ?? [
      ...existing, ...edited, ...(input.motionStatus === "manual" ? motionProtectedFieldSchema.options : []),
    ];
    const values: Partial<typeof motionStudies.$inferInsert> = {
      updatedAt: new Date(),
      protectedFields: JSON.stringify([...new Set(protections)]),
    };
    if (input.motionDNA !== undefined) values.motionDNA = input.motionDNA;
    if (input.motionThesis !== undefined) values.motionThesis = input.motionThesis;
    if (input.motionBrief !== undefined) values.motionBrief = input.motionBrief;
    if (input.analysis !== undefined) values.motionAnalysisJson = input.analysis === null ? null : JSON.stringify(input.analysis);
    if (input.beats !== undefined) values.beatsJson = JSON.stringify(input.beats);
    if (input.implementation !== undefined) values.implementationJson = JSON.stringify(input.implementation);
    if (input.inspectionNotes !== undefined) values.inspectionNotes = input.inspectionNotes === "" ? null : input.inspectionNotes;
    if (input.verifiedTech !== undefined) values.verifiedTechJson = JSON.stringify(input.verifiedTech);
    if (input.motionStatus !== undefined) values.motionStatus = input.motionStatus;
    transaction.update(motionStudies).set(values).where(eq(motionStudies.id, row.id)).run();

    if (techniques !== undefined) {
      transaction.delete(motionStudyTags).where(eq(motionStudyTags.motionStudyId, row.id)).run();
      techniques.forEach((tag, sortOrder) => {
        transaction.insert(motionStudyTags).values({ motionStudyId: row.id, sortOrder, ...tag }).run();
      });
    }
  });
  return getMotionStudy(connection, referenceId);
}

export function resetMotionAnalysis(connection: DatabaseConnection, referenceId: string): MotionStudy {
  return updateMotionStudy(connection, referenceId, { motionStatus: "pending" }, { protectEditedFields: false });
}

// ---------------------------------------------------------------------------
// Curator import
// ---------------------------------------------------------------------------

export function failedMotionResult(source: string, referenceId: string | null, code: string, message: string): MotionImportResult {
  return { source, referenceId, status: "failed", preservedFields: [], error: { code, message } };
}

export function motionReport(results: MotionImportResult[]): MotionImportReport {
  return motionImportReportSchema.parse({
    imported: results.filter((result) => result.status === "imported").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  });
}

export function importMotionAnalyses(
  connection: DatabaseConnection,
  entries: ReadonlyArray<{ source: string; value: unknown }>,
  overwriteProtected = false,
  seen = new Set<string>(),
): MotionImportReport {
  const results = entries.map(({ source, value }): MotionImportResult => {
    const parsed = motionAnalysisSchema.safeParse(value);
    if (!parsed.success) {
      const id = z.object({ referenceId: z.uuid() }).safeParse(value);
      return failedMotionResult(source, id.success ? id.data.referenceId : null, "INVALID_ANALYSIS",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
    const analysis = parsed.data;
    if (seen.has(analysis.referenceId)) {
      return failedMotionResult(source, analysis.referenceId, "DUPLICATE_REFERENCE", "Only one analysis per reference is allowed in each import batch");
    }
    seen.add(analysis.referenceId);
    try {
      return connection.database.transaction(() => {
        const current = getMotionStudy(connection, analysis.referenceId);
        const patch: UpdateMotionStudyInput = updateMotionStudySchema.parse({
          motionDNA: analysis.motionDNA,
          motionThesis: analysis.motionThesis,
          motionBrief: analysis.motionBrief,
          analysis: analysis.analysis,
          beats: analysis.beats,
          implementation: analysis.implementation,
          techniques: analysis.techniques,
          motionStatus: "analyzed",
          protectedFields: current.protectedFields,
        });
        const preservedFields = overwriteProtected ? [] : current.protectedFields.filter((field) => patch[field] !== undefined);
        const kept = Object.fromEntries(Object.entries(patch).filter(([key]) => !preservedFields.includes(key as never))) as UpdateMotionStudyInput;
        updateMotionStudy(connection, analysis.referenceId, kept, { protectEditedFields: false });
        return { source, referenceId: analysis.referenceId, status: "imported", preservedFields, error: null };
      });
    } catch (error) {
      return failedMotionResult(source, analysis.referenceId,
        error instanceof ApiError ? error.code : "IMPORT_FAILED",
        error instanceof ApiError ? error.message : "Motion analysis could not be stored; this study was left unchanged");
    }
  });
  return motionReport(results);
}

// ---------------------------------------------------------------------------
// Curator export
// ---------------------------------------------------------------------------

export async function getPendingMotion(
  connection: DatabaseConnection,
  storage: MotionStorage,
  resultsDirectory: string,
): Promise<PendingMotionManifest> {
  const pending = connection.database.select({ referenceId: motionStudies.referenceId }).from(motionStudies)
    .where(eq(motionStudies.motionStatus, "pending")).orderBy(asc(motionStudies.createdAt), asc(motionStudies.id)).all();
  const studies: PendingMotionManifest["studies"] = [];
  const unavailable: PendingMotionManifest["unavailable"] = [];

  for (const { referenceId } of pending) {
    const study = getMotionStudy(connection, referenceId);
    const design = connection.database.select({ designDNA: references.designDNA, designThesis: references.designThesis })
      .from(references).where(eq(references.id, referenceId)).get()!;
    const ready = study.clips.filter((clip) => clip.processingStatus === "ready");
    if (ready.length === 0) {
      unavailable.push({ referenceId, message: "No processed clips yet; wait for processing or retry failed clips" });
      continue;
    }
    try {
      const clips = [];
      for (const clip of ready) {
        const path = (name: string) => storage.existingPath(referenceId, clip.id, name);
        const keyframeRows = connection.database.select().from(motionKeyframes).where(eq(motionKeyframes.motionClipId, clip.id))
          .orderBy(asc(motionKeyframes.sortOrder)).all();
        const evidence = clipEvidenceSchema.parse(clip.evidence);
        clips.push({
          clipId: clip.id,
          label: clip.label,
          durationMs: clip.durationMs!,
          width: clip.width!,
          height: clip.height!,
          fps: clip.fps!,
          clipPath: await path("clip.mp4"),
          posterPath: await path("poster.webp"),
          contactSheetPath: await path("contact-sheet.webp"),
          energyTimelinePath: await path("energy.webp"),
          regionSheetPath: await path("regions.webp"),
          keyframes: await Promise.all(keyframeRows.map(async (keyframe) => ({
            index: keyframe.sortOrder, timeMs: keyframe.timeMs, reason: keyframe.reason,
            imagePath: await storage.existingPath(referenceId, clip.id, keyframe.imagePath.split("/").at(-1)!),
          }))),
          bursts: await Promise.all(evidence.bursts.map(async (burst) => ({ ...burst, imagePath: await path(burstFileName(burst.index)) }))),
          evidence,
        });
      }
      studies.push({
        referenceId,
        title: study.reference.title,
        sourceUrl: study.reference.sourceUrl,
        designContext: design,
        inspectionNotes: study.inspectionNotes,
        verifiedTech: study.verifiedTech.map((entry, index) => ({ ...entry, index })),
        protectedFields: study.protectedFields,
        clips,
      });
    } catch {
      unavailable.push({ referenceId, message: "Motion evidence is missing, unreadable, or unsafe; retry the clip" });
    }
  }

  return pendingMotionManifestSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    resultsDirectory: resolve(resultsDirectory),
    analysisSchema: motionAnalysisJsonSchema,
    studies,
    unavailable,
  });
}

// ---------------------------------------------------------------------------
// Motion section listing
// ---------------------------------------------------------------------------

function beatTriggers(beatsJson: string | null): MotionTrigger[] {
  if (beatsJson === null) return [];
  const beats = motionBeatSchema.array().safeParse(JSON.parse(beatsJson));
  if (!beats.success) return [];
  const used = new Set(beats.data.map((beat) => beat.trigger));
  return motionTriggerSchema.options.filter((trigger) => used.has(trigger));
}

export function listMotion(connection: DatabaseConnection, query: MotionListQuery): MotionListResponse {
  return connection.database.transaction(() => queryMotion(connection, query));
}

function queryMotion(connection: DatabaseConnection, query: MotionListQuery): MotionListResponse {
  const countsByTrigger = motionTriggerCounts(connection);
  const empty = () => motionListResponseSchema.parse({ items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0, countsByTrigger });
  const searchExpression = query.q ? referenceSearchExpression(query.q) : undefined;
  if (query.q && searchExpression === undefined) return empty();

  const conditions: SQL[] = [];
  if (searchExpression !== undefined) conditions.push(sql`motion_search MATCH ${searchExpression}`);
  if (query.status !== undefined) conditions.push(eq(motionStudies.motionStatus, query.status));
  if (query.trigger !== undefined) {
    conditions.push(sql`exists (select 1 from json_each(case when json_valid(${motionStudies.beatsJson}) then ${motionStudies.beatsJson} else '[]' end) b
      where json_extract(b.value, '$.trigger') = ${query.trigger})`);
  }
  if (query.technique !== undefined) {
    const normalized = query.technique.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    conditions.push(sql`exists (select 1 from motion_study_tags t where t.motion_study_id = ${motionStudies.id} and t.normalized_value = ${normalized})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Dynamic builders are joined in place, as in reference listing.
  const totalQuery = connection.database.select({ value: count() }).from(motionStudies)
    .innerJoin(references, eq(references.id, motionStudies.referenceId)).$dynamic();
  const pageQuery = connection.database.select({
    studyId: motionStudies.id, referenceId: motionStudies.referenceId, title: references.title, sourceUrl: references.sourceUrl,
    designTypeId: references.designTypeId, motionStatus: motionStudies.motionStatus, motionDNA: motionStudies.motionDNA,
    beatsJson: motionStudies.beatsJson, createdAt: motionStudies.createdAt, updatedAt: motionStudies.updatedAt,
  }).from(motionStudies).innerJoin(references, eq(references.id, motionStudies.referenceId)).$dynamic();
  if (searchExpression !== undefined) {
    const joinCondition = sql`motion_search.motion_study_id = ${motionStudies.id}`;
    totalQuery.innerJoin(sql`motion_search`, joinCondition);
    pageQuery.innerJoin(sql`motion_search`, joinCondition);
  }
  const total = totalQuery.where(where).get()?.value ?? 0;
  const order: SQL[] = query.sort === "relevance" && searchExpression !== undefined ? [motionSearchRank, desc(motionStudies.createdAt)]
    : query.sort === "oldest" ? [asc(motionStudies.createdAt)]
      : query.sort === "title-asc" ? [sql`${references.title} collate nocase asc`]
        : query.sort === "title-desc" ? [sql`${references.title} collate nocase desc`]
          : [desc(motionStudies.createdAt)];
  const offset = (query.page - 1) * query.limit;
  const rows = pageQuery.where(where).orderBy(...order, asc(motionStudies.id)).limit(query.limit).offset(offset).all();

  const studyIds = rows.map((row) => row.studyId);
  const tags = studyIds.length === 0 ? [] : connection.database.select().from(motionStudyTags)
    .where(sql`${motionStudyTags.motionStudyId} in ${studyIds}`).orderBy(asc(motionStudyTags.sortOrder)).all();
  const clips = studyIds.length === 0 ? [] : connection.database.select({
    id: motionClips.id, studyId: motionClips.motionStudyId, label: motionClips.label, sortOrder: motionClips.sortOrder,
    processingStatus: motionClips.processingStatus, durationMs: motionClips.durationMs, width: motionClips.width, height: motionClips.height,
    keyframeCount: sql<number>`(select count(*) from motion_keyframes k where k.motion_clip_id = ${motionClips.id})`,
  }).from(motionClips).where(sql`${motionClips.motionStudyId} in ${studyIds}`).orderBy(asc(motionClips.sortOrder)).all();

  return motionListResponseSchema.parse({
    items: rows.map((row, index) => {
      const own = clips.filter((clip) => clip.studyId === row.studyId);
      const primary = own[0];
      return {
        studyId: row.studyId,
        referenceId: row.referenceId,
        title: row.title,
        sourceUrl: row.sourceUrl,
        designTypeId: row.designTypeId,
        motionStatus: row.motionStatus,
        motionDNA: row.motionDNA,
        techniques: tags.filter((tag) => tag.motionStudyId === row.studyId)
          .map((tag) => ({ type: tag.type, value: tag.value, normalizedValue: tag.normalizedValue, sortOrder: tag.sortOrder })),
        triggers: beatTriggers(row.beatsJson),
        clipCount: own.length,
        primaryClip: primary === undefined ? null : {
          id: primary.id, label: primary.label, processingStatus: primary.processingStatus,
          durationMs: primary.durationMs, width: primary.width, height: primary.height, keyframeCount: primary.keyframeCount,
        },
        ...(query.includeCatalogueIndex ? { catalogueIndex: offset + index + 1 } : {}),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    countsByTrigger,
  });
}
