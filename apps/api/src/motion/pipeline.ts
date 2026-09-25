import { stat } from "node:fs/promises";
import { availableParallelism } from "node:os";

import sharp from "sharp";

import {
  maximumMotionDurationMs,
  maximumMotionHeight,
  maximumMotionWidth,
  type ClipEvidence,
  type KeyframeReason,
} from "@retr0vault/shared";

import { burstFileName, keyframeFileName, type MotionStorage } from "../storage/motion-storage.js";
import {
  analyzeSamples,
  MotionSampler,
  selectBursts,
  selectKeyframes,
} from "./analyzer.js";
import {
  integerArgument,
  probeMedia,
  runTool,
  seconds,
  UnsupportedMediaError,
  type MotionTools,
  type ProbeResult,
} from "./ffmpeg.js";
import { renderBurstStrip, renderContactSheet, renderEnergyTimeline, renderRegionSheet, type SheetFrame } from "./render.js";

/*
 * Turns one uploaded recording into playable media and motion evidence:
 *
 *   source.bin → clip.mp4 (H.264, faststart) → preview.mp4 (640 px card proxy)
 *              → dense 160 px greyscale samples → energy, regions, events
 *              → smart keyframes, burst strips, energy/region/contact sheets
 *
 * Every ffmpeg call shares one deadline. Files are written only through
 * MotionStorage, under names it manages.
 */

export const denseSampleWidth = 160;
/** Background work leaves half the machine free for the person using it. */
const encoderThreads = String(Math.max(1, Math.floor(availableParallelism() / 2)));
export const maximumSampleFps = 10;

export interface ProcessClipInput {
  readonly tools: MotionTools;
  readonly storage: MotionStorage;
  readonly referenceId: string;
  readonly clipId: string;
  readonly label: string;
  readonly posterMs: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

export interface ProcessedClip {
  readonly sourceFormat: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly bytes: number;
  readonly evidence: ClipEvidence;
  readonly keyframes: ReadonlyArray<{ timeMs: number; reason: KeyframeReason; imagePath: string }>;
}

/** A readable video that is outside the motion limits (422 rather than 415). */
export class MotionLimitError extends UnsupportedMediaError {}

/** Rejects recordings outside the motion limits with a user-facing message. */
export function assertWithinLimits(probe: ProbeResult): void {
  if (probe.videoStreamCount !== 1) throw new MotionLimitError("The recording must contain exactly one video stream");
  if (probe.durationMs > maximumMotionDurationMs + 500) throw new MotionLimitError("Recordings must be 60 seconds or shorter");
  const long = Math.max(probe.width, probe.height);
  const short = Math.min(probe.width, probe.height);
  if (long > maximumMotionWidth || short > maximumMotionHeight) throw new MotionLimitError("Recordings must be at most 3840 × 2160");
  if (probe.width < 64 || probe.height < 64) throw new MotionLimitError("Recordings must be at least 64 × 64");
}

/** A remux is enough when the source is already browser-friendly H.264 in an MP4/MOV container. */
export function canRemux(probe: ProbeResult): boolean {
  return probe.codec === "h264" && probe.pixelFormat === "yuv420p" && /(?:^|,)(?:mp4|mov)(?:,|$)/u.test(probe.formatName);
}

function evenHeight(width: number, sourceWidth: number, sourceHeight: number): number {
  return Math.max(gridSafeMinimum, Math.round((width * sourceHeight) / sourceWidth / 2) * 2);
}
const gridSafeMinimum = 12;

export async function processClip(input: ProcessClipInput): Promise<ProcessedClip> {
  const { tools, storage, referenceId, clipId } = input;
  const deadline = Date.now() + input.timeoutMs;
  const remaining = () => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("Media processing timed out");
    return left;
  };
  const run = (args: readonly string[], options: { onStdout?: (chunk: Buffer) => void; maxStdoutBytes?: number } = {}) =>
    runTool(tools.ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-filter_threads", encoderThreads, ...args], {
      timeoutMs: remaining(), signal: input.signal, ...options,
    });

  const source = await storage.existingPath(referenceId, clipId, "source.bin");
  const sourceProbe = await probeMedia(tools, source, Math.min(30_000, remaining()));
  assertWithinLimits(sourceProbe);
  await storage.clearGenerated(referenceId, clipId);

  // 1. Normalize to one playback format every browser can seek.
  const clipPart = storage.absolutePath(referenceId, clipId, "clip.part.mp4");
  if (canRemux(sourceProbe)) {
    await run(["-i", source, "-map", "0:v:0", "-c", "copy", "-an", "-sn", "-dn", "-movflags", "+faststart", "-f", "mp4", clipPart]);
  } else {
    await run(["-i", source, "-map", "0:v:0", "-an", "-sn", "-dn",
      "-vf", "scale='min(2560,iw)':-2:flags=bicubic,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", encoderThreads, "-movflags", "+faststart", "-f", "mp4", clipPart]);
  }
  await storage.promote(referenceId, clipId, "clip.part.mp4");
  const clipPath = await storage.existingPath(referenceId, clipId, "clip.mp4");
  const probe = await probeMedia(tools, clipPath, Math.min(30_000, remaining()));
  const bytes = (await stat(clipPath)).size;

  // 2. The light proxy the catalogue plates play.
  const previewPart = storage.absolutePath(referenceId, clipId, "preview.part.mp4");
  await run(["-i", clipPath, "-an", "-vf", "fps=24,scale='min(640,iw)':-2:flags=bicubic,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", encoderThreads, "-movflags", "+faststart", "-f", "mp4", previewPart]);
  await storage.promote(referenceId, clipId, "preview.part.mp4");

  // 3. Dense greyscale samples, streamed straight into the analyzer.
  const sampleFps = Math.min(maximumSampleFps, probe.fps);
  const sampleHeight = evenHeight(denseSampleWidth, probe.width, probe.height);
  const sampler = new MotionSampler(denseSampleWidth, sampleHeight, sampleFps);
  let pending: Buffer = Buffer.alloc(0);
  const maximumSamples = Math.ceil((maximumMotionDurationMs / 1_000 + 2) * maximumSampleFps);
  await run(["-i", clipPath, "-an",
    "-vf", `fps=${sampleFps.toFixed(3)},scale=${integerArgument(denseSampleWidth)}:${integerArgument(sampleHeight)}:flags=area,format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], {
    onStdout: (chunk) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= sampler.frameBytes) {
        if (sampler.samples.length >= maximumSamples) throw new Error("Too many samples");
        sampler.push(pending.subarray(0, sampler.frameBytes));
        pending = pending.subarray(sampler.frameBytes);
      }
    },
  });
  if (sampler.samples.length < 2) throw new UnsupportedMediaError("The recording is too short to analyse");

  // 4. Measure, then choose what the curator should look at.
  const analysis = analyzeSamples(sampler.samples, sampleFps, probe.durationMs);
  const frameIntervalMs = 1_000 / probe.fps;
  const keyframeChoices = selectKeyframes(probe.durationMs, frameIntervalMs, analysis.evidence.events, analysis.evidence.cutsMs);
  const bursts = selectBursts(analysis.evidence.events, probe.durationMs, frameIntervalMs, 1_000 / sampleFps);
  const lastMs = Math.max(0, Math.floor(probe.durationMs - frameIntervalMs));

  const extract = async (timeMs: number, width: number): Promise<Buffer> => {
    for (const offset of [0, 120, 400]) {
      const at = Math.max(0, Math.min(lastMs, timeMs) - offset);
      const png = await run(["-ss", seconds(at), "-i", clipPath, "-frames:v", "1", "-an",
        "-vf", `scale='min(${integerArgument(width)},iw)':-2:flags=bicubic`, "-f", "image2pipe", "-c:v", "png", "pipe:1"],
      { maxStdoutBytes: 64 * 1_024 * 1_024 });
      if (png.length > 0) return png;
    }
    throw new Error("A frame could not be extracted");
  };

  const poster = await extract(Math.min(input.posterMs, lastMs), 1_280);
  await storage.writeFile(referenceId, clipId, "poster.webp", await sharp(poster).webp({ quality: 82 }).toBuffer());

  const keyframes: Array<{ timeMs: number; reason: KeyframeReason; imagePath: string }> = [];
  const sheetFrames: SheetFrame[] = [];
  for (const [index, choice] of keyframeChoices.entries()) {
    const png = await extract(choice.timeMs, 1_280);
    const name = keyframeFileName(index);
    await storage.writeFile(referenceId, clipId, name, await sharp(png).webp({ quality: 82 }).toBuffer());
    keyframes.push({ ...choice, imagePath: storage.relativePath(referenceId, clipId, name) });
    sheetFrames.push({ image: png, timeMs: choice.timeMs, caption: `#${index} ${choice.reason.toUpperCase()}` });
  }

  for (const burst of bursts) {
    const frames: SheetFrame[] = [];
    for (const [frame, timeMs] of burst.frameTimesMs.entries()) {
      frames.push({ image: await extract(timeMs, 600), timeMs, caption: `${frame + 1}/${burst.frameTimesMs.length}` });
    }
    const event = analysis.events.find((candidate) => candidate.index === burst.eventIndex);
    await storage.writeFile(referenceId, clipId, burstFileName(burst.index), await renderBurstStrip(input.label, burst, event, frames));
  }

  await storage.writeFile(referenceId, clipId, "contact-sheet.webp", await renderContactSheet(input.label, sheetFrames));
  await storage.writeFile(referenceId, clipId, "energy.webp", await renderEnergyTimeline({
    label: input.label, durationMs: probe.durationMs, activity: analysis.activity, evidence: analysis.evidence, keyframes: keyframeChoices,
  }));
  await storage.writeFile(referenceId, clipId, "regions.webp", await renderRegionSheet(poster, analysis.evidence, analysis.events, input.label));
  await storage.writeFile(referenceId, clipId, "energy.json", `${JSON.stringify({
    sampleFps: analysis.evidence.sampleFps,
    energy: analysis.activity.map((value) => Math.round(value * 10_000) / 10_000),
    global: sampler.samples.map((sample) => Math.round(sample.global * 10_000) / 10_000),
    regions: sampler.samples.map((sample) => [...sample.regions].map((value) => Math.round(value * 1_000) / 1_000)),
  })}\n`);

  return {
    sourceFormat: `${sourceProbe.formatName.split(",")[0]}/${sourceProbe.codec}`.slice(0, 60),
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    bytes,
    evidence: { ...analysis.evidence, bursts },
    keyframes,
  };
}
