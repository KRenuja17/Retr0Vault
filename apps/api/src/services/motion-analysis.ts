import { join, resolve } from "node:path";

import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
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

import type { Db } from "../database/connection.js";
import { motionClips, motionKeyframes, motionStudies, motionStudyTags, references } from "../database/schema.js";
import { ApiError } from "../errors.js";
import { burstFileName, type MotionStorage } from "../storage/motion-storage.js";
import { findStudyRow, getMotionStudy, motionTriggerCounts } from "./motion.js";
import { motionSearchRank, searchQuery, searchWords } from "./reference-search.js";

/*
 * Motion analysis: edits, the curator export/import, and the Motion section
 * listing. Evidence (clips, keyframes, energy) is written only by the pipeline;
 * inspection notes and verified tech only by explicit edits, never by an import.
 */

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

export async function updateMotionStudy(
  db: Db,
  referenceId: string,
  input: UpdateMotionStudyInput,
  options: { readonly protectEditedFields?: boolean } = {},
): Promise<MotionStudy> {
  const row = await findStudyRow(db, referenceId);
  const current = await getMotionStudy(db, referenceId);
  if (input.beats !== undefined) assertBeats(current, input.beats);
  assertImplementation(input.implementation ?? current.implementation, input.verifiedTech ?? current.verifiedTech);
  const techniques = input.techniques === undefined ? undefined : normalizeTechniques(input.techniques);

  await db.transaction(async (transaction) => {
    const existing = motionProtectedFieldsSchema.parse(row.protectedFields);
    const edited = options.protectEditedFields === false ? [] :
      motionProtectedFieldSchema.options.filter((field) => input[field] !== undefined);
    const protections = input.protectedFields ?? [
      ...existing, ...edited, ...(input.motionStatus === "manual" ? motionProtectedFieldSchema.options : []),
    ];
    const values: Partial<typeof motionStudies.$inferInsert> = {
      updatedAt: new Date(),
      protectedFields: [...new Set(protections)],
    };
    if (input.motionDNA !== undefined) values.motionDNA = input.motionDNA;
    if (input.motionThesis !== undefined) values.motionThesis = input.motionThesis;
    if (input.motionBrief !== undefined) values.motionBrief = input.motionBrief;
    if (input.analysis !== undefined) values.motionAnalysisJson = input.analysis;
    if (input.beats !== undefined) values.beatsJson = input.beats;
    if (input.implementation !== undefined) values.implementationJson = input.implementation;
    if (input.inspectionNotes !== undefined) values.inspectionNotes = input.inspectionNotes === "" ? null : input.inspectionNotes;
    if (input.verifiedTech !== undefined) values.verifiedTechJson = input.verifiedTech;
    if (input.motionStatus !== undefined) values.motionStatus = input.motionStatus;
    await transaction.update(motionStudies).set(values).where(eq(motionStudies.id, row.id));

    if (techniques !== undefined) {
      await transaction.delete(motionStudyTags).where(eq(motionStudyTags.motionStudyId, row.id));
      if (techniques.length > 0) {
        await transaction.insert(motionStudyTags).values(techniques.map((tag, sortOrder) => ({ motionStudyId: row.id, sortOrder, ...tag })));
      }
    }
  });
  return getMotionStudy(db, referenceId);
}

export function resetMotionAnalysis(db: Db, referenceId: string): Promise<MotionStudy> {
  return updateMotionStudy(db, referenceId, { motionStatus: "pending" }, { protectEditedFields: false });
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

export async function importMotionAnalyses(
  db: Db,
  entries: ReadonlyArray<{ source: string; value: unknown }>,
  overwriteProtected = false,
  seen = new Set<string>(),
): Promise<MotionImportReport> {
  const results: MotionImportResult[] = [];
  for (const entry of entries) results.push(await importOneMotion(db, entry, overwriteProtected, seen));
  return motionReport(results);
}

async function importOneMotion(
  db: Db,
  { source, value }: { source: string; value: unknown },
  overwriteProtected: boolean,
  seen: Set<string>,
): Promise<MotionImportResult> {
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
    return await db.transaction(async (transaction) => {
      const current = await getMotionStudy(transaction, analysis.referenceId);
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
      await updateMotionStudy(transaction, analysis.referenceId, kept, { protectEditedFields: false });
      return { source, referenceId: analysis.referenceId, status: "imported" as const, preservedFields, error: null };
    });
  } catch (error) {
    return failedMotionResult(source, analysis.referenceId,
      error instanceof ApiError ? error.code : "IMPORT_FAILED",
      error instanceof ApiError ? error.message : "Motion analysis could not be stored; this study was left unchanged");
  }
}

// ---------------------------------------------------------------------------
// Curator export
// ---------------------------------------------------------------------------

/**
 * The motion studies awaiting analysis. Evidence paths are on this PC: the
 * stored files for a local store, or copies in `<data>/motion-inbox/evidence`
 * when files live in the bucket.
 */
export async function getPendingMotion(
  db: Db,
  storage: MotionStorage,
  dataDirectory: string,
): Promise<PendingMotionManifest> {
  const inbox = join(dataDirectory, "motion-inbox");
  const pending = await db.select({ referenceId: motionStudies.referenceId }).from(motionStudies)
    .where(eq(motionStudies.motionStatus, "pending")).orderBy(asc(motionStudies.createdAt), asc(motionStudies.id));
  const studies: PendingMotionManifest["studies"] = [];
  const unavailable: PendingMotionManifest["unavailable"] = [];

  for (const { referenceId } of pending) {
    const study = await getMotionStudy(db, referenceId);
    const [design] = await db.select({ designDNA: references.designDNA, designThesis: references.designThesis })
      .from(references).where(eq(references.id, referenceId));
    const ready = study.clips.filter((clip) => clip.processingStatus === "ready");
    if (ready.length === 0) {
      unavailable.push({ referenceId, message: "No processed clips yet; wait for processing or retry failed clips" });
      continue;
    }
    try {
      const clips = [];
      for (const clip of ready) {
        const path = (name: string) => storage.locate(referenceId, clip.id, name, inbox);
        const keyframeRows = await db.select().from(motionKeyframes).where(eq(motionKeyframes.motionClipId, clip.id))
          .orderBy(asc(motionKeyframes.sortOrder));
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
            imagePath: await path(keyframe.imagePath.split("/").at(-1)!),
          }))),
          bursts: await Promise.all(evidence.bursts.map(async (burst) => ({ ...burst, imagePath: await path(burstFileName(burst.index)) }))),
          evidence,
        });
      }
      studies.push({
        referenceId,
        title: study.reference.title,
        sourceUrl: study.reference.sourceUrl,
        designContext: design!,
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
    resultsDirectory: resolve(dataDirectory, "motion-results"),
    analysisSchema: motionAnalysisJsonSchema,
    studies,
    unavailable,
  });
}

// ---------------------------------------------------------------------------
// Motion section listing
// ---------------------------------------------------------------------------

function beatTriggers(beatsJson: unknown): MotionTrigger[] {
  if (beatsJson === null || beatsJson === undefined) return [];
  const beats = motionBeatSchema.array().safeParse(beatsJson);
  if (!beats.success) return [];
  const used = new Set(beats.data.map((beat) => beat.trigger));
  return motionTriggerSchema.options.filter((trigger) => used.has(trigger));
}

/**
 * One page of the motion section, in two pipelined round trips (counts and
 * page together, then the page's tags and clips), as for references.
 */
export async function listMotion(db: Db, query: MotionListQuery): Promise<MotionListResponse> {
  const words = query.q ? searchWords(query.q) : undefined;
  if (query.q && words === undefined) {
    const countsByTrigger = await motionTriggerCounts(db);
    return motionListResponseSchema.parse({ items: [], page: query.page, limit: query.limit, total: 0, totalPages: 0, countsByTrigger });
  }

  const conditions: SQL[] = [];
  if (words !== undefined) conditions.push(sql`motion_search.document @@ ${searchQuery(words)}`);
  if (query.status !== undefined) conditions.push(eq(motionStudies.motionStatus, query.status));
  if (query.trigger !== undefined) {
    conditions.push(sql`exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${motionStudies.beatsJson}) = 'array' then ${motionStudies.beatsJson} else '[]'::jsonb end) b
      where b ->> 'trigger' = ${query.trigger})`);
  }
  if (query.technique !== undefined) {
    const normalized = query.technique.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    conditions.push(sql`exists (select 1 from motion_study_tags t where t.motion_study_id = ${motionStudies.id} and t.normalized_value = ${normalized})`);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Dynamic builders are joined in place, as in reference listing.
  const totalQuery = db.select({ value: count() }).from(motionStudies)
    .innerJoin(references, eq(references.id, motionStudies.referenceId)).$dynamic();
  const pageQuery = db.select({
    studyId: motionStudies.id, referenceId: motionStudies.referenceId, title: references.title, sourceUrl: references.sourceUrl,
    designTypeId: references.designTypeId, motionStatus: motionStudies.motionStatus, motionDNA: motionStudies.motionDNA,
    beatsJson: motionStudies.beatsJson, createdAt: motionStudies.createdAt, updatedAt: motionStudies.updatedAt,
  }).from(motionStudies).innerJoin(references, eq(references.id, motionStudies.referenceId)).$dynamic();
  if (words !== undefined) {
    const joinCondition = sql`motion_search.motion_study_id = ${motionStudies.id}`;
    totalQuery.innerJoin(sql`motion_search`, joinCondition);
    pageQuery.innerJoin(sql`motion_search`, joinCondition);
  }
  const order: SQL[] = query.sort === "relevance" && words !== undefined ? [sql`${motionSearchRank(words)} desc`, desc(motionStudies.createdAt)]
    : query.sort === "oldest" ? [asc(motionStudies.createdAt)]
      : query.sort === "title-asc" ? [sql`lower(${references.title}) asc`]
        : query.sort === "title-desc" ? [sql`lower(${references.title}) desc`]
          : [desc(motionStudies.createdAt)];
  const offset = (query.page - 1) * query.limit;
  const [countsByTrigger, [totalRow], rows] = await Promise.all([
    motionTriggerCounts(db),
    totalQuery.where(where),
    pageQuery.where(where).orderBy(...order, asc(motionStudies.id)).limit(query.limit).offset(offset),
  ]);
  const total = totalRow?.value ?? 0;

  const studyIds = rows.map((row) => row.studyId);
  const [tags, clips] = studyIds.length === 0 ? [[], []] : await Promise.all([
    db.select().from(motionStudyTags)
      .where(inArray(motionStudyTags.motionStudyId, studyIds)).orderBy(asc(motionStudyTags.sortOrder)),
    db.select({
      id: motionClips.id, studyId: motionClips.motionStudyId, label: motionClips.label, sortOrder: motionClips.sortOrder,
      processingStatus: motionClips.processingStatus, durationMs: motionClips.durationMs, width: motionClips.width, height: motionClips.height,
      keyframeCount: sql<number>`(select count(*)::integer from motion_keyframes k where k.motion_clip_id = ${motionClips.id})`,
    }).from(motionClips).where(inArray(motionClips.motionStudyId, studyIds)).orderBy(asc(motionClips.sortOrder)),
  ]);

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
