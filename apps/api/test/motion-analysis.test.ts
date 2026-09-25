import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  errorResponseSchema,
  motionImportReportSchema,
  motionListResponseSchema,
  motionStudySchema,
  pendingMotionManifestSchema,
  referenceResponseSchema,
  statsResponseSchema,
  type ClipEvidence,
  type MotionAnalysis,
} from "@retr0vault/shared";

import { createDatabaseConnection } from "../src/database/connection.js";
import { resolveMotionTools } from "../src/motion/ffmpeg.js";
import { exportPendingMotion, importMotionFiles } from "../src/motion/cli.js";
import type { ClipProcessor } from "../src/motion/queue.js";
import { MotionStorage } from "../src/storage/motion-storage.js";
import { createMultipartPayload, createTestApp, disposeTestApp, type TestAppContext } from "./helpers.js";

const tools = resolveMotionTools();
if (tools === undefined) throw new Error("The bundled ffmpeg/ffprobe must be installed to run motion tests");

let fixtures: string;
beforeAll(() => {
  fixtures = mkdtempSync(join(tmpdir(), "retr0vault-motion-analysis-"));
  execFileSync(tools.ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x200:d=2.5:r=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", join(fixtures, "clip.mp4")]);
}, 60_000);
afterAll(() => rmSync(fixtures, { recursive: true, force: true }));

const evidence: ClipEvidence = {
  sampleFps: 10, sampleCount: 2, gridColumns: 8, gridRows: 6, threshold: 0.012, meanEnergy: 0,
  events: [], cutsMs: [], bursts: [], regionTotals: new Array(48).fill(0),
};
const instant: ClipProcessor = async () => ({
  sourceFormat: "mov/h264", durationMs: 2_500, width: 320, height: 200, fps: 30, bytes: 1, evidence, keyframes: [],
});

async function createReference(context: TestAppContext, title = "Motion reference"): Promise<string> {
  const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: "white" } }).png().toBuffer();
  const multipart = createMultipartPayload({ fields: { title }, file: { buffer: image } });
  const response = await context.app.inject({ method: "POST", url: "/api/v1/references/image", ...multipart });
  return referenceResponseSchema.parse(response.json()).id;
}

async function withClip(context: TestAppContext, title?: string) {
  const referenceId = await createReference(context, title);
  const multipart = createMultipartPayload({ file: { buffer: readFileSync(join(fixtures, "clip.mp4")), filename: "clip.mp4" } });
  const response = await context.app.inject({ method: "POST", url: `/api/v1/references/${referenceId}/motion/clips`, ...multipart });
  expect(response.statusCode, response.body).toBe(202);
  await context.app.motionQueue.idle();
  const study = motionStudySchema.parse((await context.app.inject({ url: `/api/v1/references/${referenceId}/motion` })).json());
  return { referenceId, study, clipId: study.clips[0]!.id };
}

function analysis(referenceId: string, clipId: string, overrides: Partial<MotionAnalysis> = {}): MotionAnalysis {
  return {
    referenceId,
    motionDNA: "wheel-driven camera × block assembly",
    motionThesis: "The camera travels through staged scenes while blocks assemble.",
    techniques: [{ type: "technique", value: "Block assembly" }, { type: "trigger", value: "mouse wheel" }],
    beats: [
      { clipId, startMs: 0, endMs: 900, trigger: "load", label: "ASCII loader", description: "A line of characters fills." },
      { clipId, startMs: 900, endMs: 2_400, trigger: "wheel", label: "Camera push", description: "The camera travels forward." },
    ],
    motionBrief: "Pace scenes with camera travel rather than sections.",
    implementation: [{ claim: "Scroll is virtualised", evidence: "inferred", verifiedTechIndex: null }],
    analysis: {
      triggers: ["mouse wheel drives the camera"], choreography: [], pacing: [], easing: [], cameraAndSpace: [],
      typographyMotion: [], imageTreatment: [], interaction: [], performance: [], avoid: ["card grids"],
    },
    ...overrides,
  };
}

function expectError(response: Awaited<ReturnType<TestAppContext["app"]["inject"]>>, status: number, code: string) {
  expect(response.statusCode, response.body).toBe(status);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe(code);
}

describe("motion study edits", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  it("validates beats and verified claims, and protects edited fields", async () => {
    context = await createTestApp("motion-edit", { motionProcessor: instant });
    const { referenceId, clipId } = await withClip(context);
    const patch = (payload: Record<string, unknown>) => context.app.inject({ method: "PATCH", url: `/api/v1/references/${referenceId}/motion`, payload });

    expectError(await patch({ beats: [{ clipId: "00000000-0000-4000-8000-000000000000", startMs: 0, endMs: null, trigger: "load", label: "x", description: "y" }] }), 400, "INVALID_BEAT");
    expectError(await patch({ beats: [{ clipId, startMs: 9_000, endMs: null, trigger: "load", label: "x", description: "y" }] }), 400, "INVALID_BEAT");
    expectError(await patch({ beats: [
      { clipId, startMs: 1_000, endMs: null, trigger: "load", label: "b", description: "y" },
      { clipId, startMs: 0, endMs: null, trigger: "load", label: "a", description: "y" },
    ] }), 400, "INVALID_BEAT");
    expectError(await patch({ implementation: [{ claim: "GSAP drives it", evidence: "verified", verifiedTechIndex: 0 }] }), 400, "UNVERIFIED_IMPLEMENTATION");
    expectError(await patch({ implementation: [{ claim: "GSAP drives it", evidence: "verified", verifiedTechIndex: null }] }), 400, "VALIDATION_ERROR");
    expectError(await patch({ techniques: [{ type: "technique", value: "Wipe" }, { type: "technique", value: " wipe " }] }), 400, "VALIDATION_ERROR");

    const saved = await patch({
      motionDNA: "block-wipe reveals",
      inspectionNotes: "Helmet livery follows the cursor.",
      verifiedTech: [{ claim: "window.gsap and ScrollTrigger defined", source: "DevTools console" }],
      implementation: [{ claim: "GSAP ScrollTrigger drives the reveals", evidence: "verified", verifiedTechIndex: 0 }],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const study = motionStudySchema.parse(saved.json());
    expect(study.protectedFields).toEqual(["motionDNA", "implementation"]);
    expect(study.verifiedTech).toHaveLength(1);
    expect(study.inspectionNotes).toBe("Helmet livery follows the cursor.");

    // Removing the verified tech a claim relies on is refused.
    expectError(await patch({ verifiedTech: [] }), 400, "UNVERIFIED_IMPLEMENTATION");
    const manual = motionStudySchema.parse((await patch({ motionStatus: "manual" })).json());
    expect(manual.protectedFields).toHaveLength(7);
    const unlocked = motionStudySchema.parse((await patch({ protectedFields: [] })).json());
    expect(unlocked.protectedFields).toEqual([]);
  });
});

describe("motion curator import", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));
  const importBatch = (analyses: unknown[], overwriteProtected = false) =>
    context.app.inject({ method: "POST", url: "/api/v1/motion/import", payload: { analyses, overwriteProtected } });

  it("imports analyses, preserves protected fields, and returns to pending on new evidence", async () => {
    context = await createTestApp("motion-import", { motionProcessor: instant });
    const { referenceId, clipId } = await withClip(context);

    let report = motionImportReportSchema.parse((await importBatch([analysis(referenceId, clipId)])).json());
    expect(report).toMatchObject({ imported: 1, failed: 0 });
    let study = motionStudySchema.parse((await context.app.inject({ url: `/api/v1/references/${referenceId}/motion` })).json());
    expect(study.motionStatus).toBe("analyzed");
    expect(study.techniques.map((tag) => [tag.type, tag.normalizedValue])).toEqual([["technique", "block assembly"], ["trigger", "mouse wheel"]]);
    expect(study.beats).toHaveLength(2);
    expect(study.protectedFields).toEqual([]);

    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${referenceId}/motion`, payload: { motionDNA: "my own words" } });
    report = motionImportReportSchema.parse((await importBatch([analysis(referenceId, clipId, { motionDNA: "curator words" })])).json());
    expect(report.results[0]!.preservedFields).toEqual(["motionDNA"]);
    study = motionStudySchema.parse((await context.app.inject({ url: `/api/v1/references/${referenceId}/motion` })).json());
    expect(study.motionDNA).toBe("my own words");
    report = motionImportReportSchema.parse((await importBatch([analysis(referenceId, clipId, { motionDNA: "curator words" })], true)).json());
    expect(report.results[0]!.preservedFields).toEqual([]);
    study = motionStudySchema.parse((await context.app.inject({ url: `/api/v1/references/${referenceId}/motion` })).json());
    expect(study.motionDNA).toBe("curator words");
    expect(study.protectedFields).toEqual(["motionDNA"]);

    // A new recording means new evidence: the study goes back to pending.
    const multipart = createMultipartPayload({ file: { buffer: readFileSync(join(fixtures, "clip.mp4")), filename: "clip.mp4" } });
    await context.app.inject({ method: "POST", url: `/api/v1/references/${referenceId}/motion/clips`, ...multipart });
    await context.app.motionQueue.idle();
    study = motionStudySchema.parse((await context.app.inject({ url: `/api/v1/references/${referenceId}/motion` })).json());
    expect(study.motionStatus).toBe("pending");

    const reset = await context.app.inject({ method: "POST", url: `/api/v1/motion/${referenceId}/reset`, payload: {} });
    expect(motionStudySchema.parse(reset.json()).motionStatus).toBe("pending");
  });

  it("reports each invalid record without touching the others", async () => {
    context = await createTestApp("motion-import-invalid", { motionProcessor: instant });
    const { referenceId, clipId } = await withClip(context);
    const other = await createReference(context);
    const report = motionImportReportSchema.parse((await importBatch([
      { referenceId, motionDNA: "missing fields" },
      analysis(other, clipId),
      analysis(referenceId, clipId, { implementation: [{ claim: "WebGL2", evidence: "verified", verifiedTechIndex: 0 }] }),
      { ...analysis(referenceId, clipId), inspectionNotes: "not importable" },
      analysis(referenceId, clipId),
      analysis(referenceId, clipId),
    ])).json());
    expect(report.results.map((result) => result.status === "imported" ? "ok" : result.error!.code)).toEqual([
      // As with design analysis, the first schema-valid record owns its ID for the batch, even if it then fails.
      "INVALID_ANALYSIS", "MOTION_STUDY_NOT_FOUND", "UNVERIFIED_IMPLEMENTATION", "INVALID_ANALYSIS", "DUPLICATE_REFERENCE", "DUPLICATE_REFERENCE",
    ]);
    const untouched = motionStudySchema.parse((await context.app.inject({ url: `/api/v1/references/${referenceId}/motion` })).json());
    expect(untouched).toMatchObject({ motionStatus: "pending", motionDNA: null, beats: [], techniques: [] });
    expect((await context.app.inject({ method: "POST", url: "/api/v1/motion/import", payload: { analyses: [] } })).statusCode).toBe(400);
  });
});

describe("motion section listing and search", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  it("lists only studies, filters by trigger, technique, status and words, and follows renames", async () => {
    context = await createTestApp("motion-list", { motionProcessor: instant });
    await createReference(context, "Plain reference");
    const igloo = await withClip(context, "Igloo Inc.");
    const lando = await withClip(context, "Lando Norris");
    await context.app.inject({ method: "POST", url: "/api/v1/motion/import", payload: { analyses: [analysis(igloo.referenceId, igloo.clipId)] } });
    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${lando.referenceId}/motion`, payload: {
      inspectionNotes: "Helmet livery sweeps across the portrait",
      beats: [{ clipId: lando.clipId, startMs: 0, endMs: 800, trigger: "cursor", label: "Livery sweep", description: "The helmet appears." }],
    } });

    const list = async (query = "") => motionListResponseSchema.parse((await context.app.inject({ url: `/api/v1/motion${query}` })).json());
    const all = await list("?includeCatalogueIndex=true&sort=title-asc");
    expect(all.items.map((item) => [item.title, item.catalogueIndex])).toEqual([["Igloo Inc.", 1], ["Lando Norris", 2]]);
    expect(all.items[0]!.triggers).toEqual(["load", "wheel"]);
    expect(all.items[0]!.primaryClip).toMatchObject({ id: igloo.clipId, processingStatus: "ready", durationMs: 2_500, keyframeCount: 0 });
    expect(all.countsByTrigger.filter((entry) => entry.count > 0)).toEqual([
      { trigger: "load", count: 1 }, { trigger: "wheel", count: 1 }, { trigger: "cursor", count: 1 },
    ]);

    expect((await list("?trigger=cursor")).items.map((item) => item.title)).toEqual(["Lando Norris"]);
    expect((await list("?technique=block%20assembly")).items.map((item) => item.title)).toEqual(["Igloo Inc."]);
    expect((await list("?status=analyzed")).items.map((item) => item.title)).toEqual(["Igloo Inc."]);
    expect((await list("?q=wheel%20camera")).items.map((item) => item.title)).toEqual(["Igloo Inc."]);
    expect((await list("?q=livery")).items.map((item) => item.title)).toEqual(["Lando Norris"]);
    expect((await list("?q=%2B%2B%2B")).total).toBe(0);

    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${lando.referenceId}`, payload: { title: "McLaren driver" } });
    expect((await list("?q=mclaren")).items.map((item) => item.referenceId)).toEqual([lando.referenceId]);

    const stats = statsResponseSchema.parse((await context.app.inject({ url: "/api/v1/stats" })).json());
    expect(stats.motionStudies).toMatchObject({ total: 2, analyzed: 1, pending: 1 });

    await context.app.inject({ method: "DELETE", url: `/api/v1/references/${lando.referenceId}` });
    const connection = createDatabaseConnection(context.databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM motion_search").get()).toEqual({ count: 1 });
    } finally {
      connection.sqlite.close();
    }
  });
});

describe("motion curator export", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  it("exports every piece of evidence with absolute paths, and imports result files", async () => {
    context = await createTestApp("motion-export");
    const { referenceId, study } = await withClip(context, "Exported study");
    const ready = study.clips[0]!;
    expect(ready.processingStatus, ready.processingError ?? "").toBe("ready");
    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${referenceId}/motion`, payload: {
      verifiedTech: [{ claim: "Page requests a WebGL2 context", source: "canvas getContext instrumentation" }],
    } });
    const waiting = await createReference(context, "Still processing");
    const connection = createDatabaseConnection(context.databasePath);
    try {
      // A study whose only clip is still queued is reported, not exported.
      const now = Date.now();
      connection.sqlite.prepare("INSERT INTO motion_studies (id, reference_id, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', ?, ?, ?)").run(waiting, now, now);
      connection.sqlite.prepare(`INSERT INTO motion_clips (id, motion_study_id, label, sort_order, processing_status, created_at, updated_at)
        VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Queued', 0, 'queued', ?, ?)`).run(now, now);

      const manifest = pendingMotionManifestSchema.parse((await context.app.inject({ url: "/api/v1/motion/pending" })).json());
      expect(manifest.unavailable.map((entry) => entry.referenceId)).toEqual([waiting]);
      const [exported] = manifest.studies;
      expect(exported).toMatchObject({ referenceId, title: "Exported study", verifiedTech: [{ index: 0, claim: "Page requests a WebGL2 context" }] });
      const [clip] = exported!.clips;
      for (const path of [clip!.clipPath, clip!.posterPath, clip!.contactSheetPath, clip!.energyTimelinePath, clip!.regionSheetPath,
        ...clip!.keyframes.map((keyframe) => keyframe.imagePath), ...clip!.bursts.map((burst) => burst.imagePath)]) {
        expect(existsSync(path), path).toBe(true);
      }
      expect(clip!.keyframes.length).toBe(ready.keyframes.length);
      expect(manifest.analysisSchema).toHaveProperty("properties.beats");

      const dataDirectory = join(context.directory, "data");
      const written = await exportPendingMotion(connection, new MotionStorage(context.storageRoot), dataDirectory);
      expect(written.exported).toBe(1);
      expect(readFileSync(join(dataDirectory, "motion-inbox", "instructions.md"), "utf8")).toContain("verifiedTechIndex");

      const results = join(dataDirectory, "motion-results");
      mkdirSync(results, { recursive: true });
      writeFileSync(join(results, `${referenceId}.json`), JSON.stringify(analysis(referenceId, ready.id, {
        beats: [{ clipId: ready.id, startMs: 0, endMs: 1_000, trigger: "time", label: "Pattern drifts", description: "Bars move." }],
        implementation: [{ claim: "WebGL2", evidence: "verified", verifiedTechIndex: 0 }],
      })));
      writeFileSync(join(results, "broken.json"), "{");
      const report = await importMotionFiles(connection, results);
      // Files are read in name order, and the result's name is a random UUID, so compare per file.
      expect(Object.fromEntries(report.results.map((result) => [result.source, result.status]))).toEqual({
        [`${referenceId}.json`]: "imported", "broken.json": "failed",
      });
    } finally {
      connection.sqlite.close();
    }
  }, 60_000);
});

describe("motion in exports", () => {
  let context: TestAppContext;
  afterEach(async () => disposeTestApp(context));

  it("adds the motion study to reference exports and the combination manifest", async () => {
    context = await createTestApp("motion-export-markdown", { motionProcessor: instant });
    const { referenceId, clipId } = await withClip(context, "Exported motion");
    const still = await createReference(context, "Still only");
    await context.app.inject({ method: "PATCH", url: `/api/v1/references/${referenceId}/motion`, payload: {
      verifiedTech: [{ claim: "html.lenis class present", source: "DevTools" }],
    } });
    await context.app.inject({ method: "POST", url: "/api/v1/motion/import", payload: { analyses: [analysis(referenceId, clipId, {
      implementation: [
        { claim: "Smooth scrolling via Lenis", evidence: "verified", verifiedTechIndex: 0 },
        { claim: "Wipes use clip-path", evidence: "inferred", verifiedTechIndex: null },
      ],
    })] } });

    const markdown = await context.app.inject({ method: "POST", url: "/api/v1/export/references",
      payload: { mode: "references", referenceIds: [referenceId, still] } });
    expect(markdown.statusCode, markdown.body).toBe(200);
    expect(markdown.body).toContain("### Motion Study");
    expect(markdown.body).toContain("- Recordings: Primary (00:02.50)");
    expect(markdown.body).toContain("00:00.90–00:02.40 WHEEL Camera push (Primary): The camera travels forward.");
    expect(markdown.body).toContain("Verified: Smooth scrolling via Lenis — html.lenis class present (DevTools)");
    expect(markdown.body).toContain("Inferred: Wipes use clip-path");
    // A reference without recordings exports exactly as before.
    expect(markdown.body.split("## Still only")[1]).not.toContain("Motion Study");

    const manifest = await context.app.inject({ method: "POST", url: "/api/v1/export/design-direction",
      payload: { mode: "pending-combination", referenceIds: [referenceId, still] } });
    expect(manifest.statusCode, manifest.body).toBe(200);
    expect(manifest.body).toContain("prefer a reference whose motionStudy is analyzed");
    const snapshot = JSON.parse(/```json\n([\s\S]*?)\n```/u.exec(manifest.body)![1]!) as {
      references: Array<{ motionStudy: null | { motionStatus: string; beats: Array<{ clipLabel: string }>; implementation: Array<{ source: unknown }> } }>;
    };
    expect(snapshot.references[0]!.motionStudy).toMatchObject({ motionStatus: "analyzed" });
    expect(snapshot.references[0]!.motionStudy!.beats[0]!.clipLabel).toBe("Primary");
    expect(snapshot.references[0]!.motionStudy!.implementation[0]!.source).toEqual({ claim: "html.lenis class present", source: "DevTools" });
    expect(snapshot.references[1]!.motionStudy).toBeNull();
  });
});

