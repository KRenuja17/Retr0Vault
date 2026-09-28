import { join, resolve } from "node:path";

import { and, asc, eq, or } from "drizzle-orm";
import { z } from "zod";

import {
  analysisImportReportSchema,
  pendingAnalysisManifestSchema,
  protectedFieldsSchema,
  referenceAnalysisJsonSchema,
  referenceAnalysisSchema,
  updateReferenceSchema,
  type AnalysisImportReport,
  type AnalysisImportResult,
  type PendingAnalysisManifest,
} from "@retr0vault/shared";

import type { Db } from "../database/connection.js";
import { designTypes, references, referenceFrames } from "../database/schema.js";
import { ApiError } from "../errors.js";
import type { ReferenceStorage } from "../storage/reference-storage.js";
import { assertOwnedReference, ownedBy, type Owner } from "./ownership.js";
import { getReference, updateReference } from "./references.js";

/**
 * The references awaiting analysis. Image paths are on this PC: the stored
 * files for a local store, or copies in `<data>/analysis-inbox/images` when
 * files live in the bucket.
 */
export async function getPendingAnalysis(
  db: Db,
  storage: ReferenceStorage,
  dataDirectory: string,
  owner?: Owner,
): Promise<PendingAnalysisManifest> {
  const inbox = join(dataDirectory, "analysis-inbox");
  const pending = await db.select().from(references)
    .where(and(eq(references.analysisStatus, "pending"), ownedBy(references.ownerId, owner)))
    .orderBy(asc(references.createdAt), asc(references.id));
  const items: PendingAnalysisManifest["references"] = [];
  const unavailable: PendingAnalysisManifest["unavailable"] = [];

  for (const reference of pending) {
    try {
      const imagePath = await storage.locateOriginalImage(reference.id, reference.originalPath, inbox);
      const frames = await db.select().from(referenceFrames).where(eq(referenceFrames.referenceId, reference.id))
        .orderBy(asc(referenceFrames.sortOrder));
      const availableFrames = await Promise.all(frames.map(async (frame) => ({
        frameType: frame.frameType, sortOrder: frame.sortOrder,
        imagePath: await storage.locateCaptureFrame(reference.id, frame.imagePath, inbox),
      })));
      items.push({
        referenceId: reference.id,
        title: reference.title,
        sourceUrl: reference.sourceUrl,
        imagePath,
        frames: availableFrames,
        protectedFields: protectedFieldsSchema.parse(reference.protectedFields),
      });
    } catch {
      unavailable.push({ referenceId: reference.id, message: "Original image is missing, unreadable, or unsafe" });
    }
  }

  return pendingAnalysisManifestSchema.parse({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    resultsDirectory: resolve(dataDirectory, "analysis-results"),
    analysisSchema: referenceAnalysisJsonSchema,
    designTypes: await db.select({
      id: designTypes.id, name: designTypes.name, slug: designTypes.slug,
    }).from(designTypes).orderBy(asc(designTypes.sortOrder), asc(designTypes.id)),
    references: items,
    unavailable,
  });
}

export function failedAnalysisResult(
  source: string,
  referenceId: string | null,
  code: string,
  message: string,
): AnalysisImportResult {
  return { source, referenceId, status: "failed", preservedFields: [], error: { code, message } };
}

export function analysisReport(results: AnalysisImportResult[]): AnalysisImportReport {
  return analysisImportReportSchema.parse({
    imported: results.filter((result) => result.status === "imported").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  });
}

export interface AnalysisEntry {
  readonly source: string;
  readonly value: unknown;
}

export async function importAnalyses(
  db: Db,
  entries: readonly AnalysisEntry[],
  overwriteProtected = false,
  seen = new Set<string>(),
  owner?: Owner,
): Promise<AnalysisImportReport> {
  const results: AnalysisImportResult[] = [];
  for (const entry of entries) results.push(await importOne(db, entry, overwriteProtected, seen, owner));
  return analysisReport(results);
}

async function importOne(
  db: Db,
  { source, value }: AnalysisEntry,
  overwriteProtected: boolean,
  seen: Set<string>,
  owner: Owner,
): Promise<AnalysisImportResult> {
  const parsed = referenceAnalysisSchema.safeParse(value);
  if (!parsed.success) {
    const id = z.object({ referenceId: z.uuid() }).safeParse(value);
    return failedAnalysisResult(source, id.success ? id.data.referenceId : null,
      "INVALID_ANALYSIS", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }

  const analysis = parsed.data;
  if (seen.has(analysis.referenceId)) {
    return failedAnalysisResult(source, analysis.referenceId, "DUPLICATE_REFERENCE", "Only one analysis per reference is allowed in each import batch");
  }
  seen.add(analysis.referenceId);

  try {
    // One transaction per reference: tags, metadata, status, and protections
    // either commit together or leave this reference entirely unchanged.
    return await db.transaction(async (transaction) => {
      // Another account's reference is as missing as an unknown one.
      await assertOwnedReference(transaction, analysis.referenceId, owner);
      const current = await getReference(transaction, analysis.referenceId);
      const matches = await transaction.select({ id: designTypes.id }).from(designTypes)
        .where(or(eq(designTypes.name, analysis.designType), eq(designTypes.slug, analysis.designType)));
      if (matches.length !== 1) {
        throw new ApiError(400, "INVALID_DESIGN_TYPE", "Use an unambiguous existing design-type name or slug from the manifest");
      }
      const protections = current.protectedFields;
      const patch = updateReferenceSchema.parse({
        title: analysis.title,
        designTypeId: matches[0]!.id,
        designDNA: analysis.designDNA,
        designThesis: analysis.designThesis,
        designBrief: analysis.designBrief,
        imageRecipe: analysis.imageRecipe,
        ...(analysis.motionBrief === undefined ? {} : { motionBrief: analysis.motionBrief }),
        ...(analysis.assetBrief === undefined ? {} : { assetBrief: analysis.assetBrief }),
        analysisJson: analysis.analysis,
        tags: analysis.visualTags,
        analysisStatus: "analyzed",
        protectedFields: protections,
      });
      const preservedFields = overwriteProtected ? [] : protections.filter((field) => Object.hasOwn(patch, field));
      for (const field of preservedFields) delete patch[field];
      await updateReference(transaction, analysis.referenceId, patch, { protectEditedFields: false });
      return { source, referenceId: analysis.referenceId, status: "imported" as const, preservedFields, error: null };
    });
  } catch (error) {
    return failedAnalysisResult(source, analysis.referenceId,
      error instanceof ApiError ? error.code : "IMPORT_FAILED",
      error instanceof ApiError ? error.message : "Analysis could not be stored; this reference was left unchanged");
  }
}

export function resetAnalysis(db: Db, referenceId: string) {
  return updateReference(db, referenceId, { analysisStatus: "pending" }, { protectEditedFields: false });
}
