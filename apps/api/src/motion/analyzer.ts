import type { ClipEvidence, KeyframeReason, MotionBurst, MotionEvent } from "@retr0vault/shared";

/*
 * Pure motion-evidence analysis. Nothing here touches files or processes, so
 * every rule (energy, regions, events, keyframe choice, bursts) is unit-tested
 * on synthetic numbers.
 *
 * Everything the pipeline measures is a *computed hint* for the curator: it
 * says when and where the picture changed, never why.
 */

export const gridColumns = 8;
export const gridRows = 6;
export const cellCount = gridColumns * gridRows;
export const maximumKeyframes = 24;
export const maximumBursts = 4;
export const burstFrameCount = 8;

/** One dense sample: whole-frame change and per-cell change against the previous sample. */
export interface MotionSample {
  readonly timeMs: number;
  /** Mean absolute luminance change of the whole frame, 0–1. */
  readonly global: number;
  /** Mean absolute change per grid cell, row-major, 0–1. */
  readonly regions: Float32Array;
}

/**
 * Accumulates dense greyscale frames into samples. Frames arrive in time order
 * at `sampleFps`; the first sample has zero change by definition.
 */
export class MotionSampler {
  readonly #width: number;
  readonly #height: number;
  readonly #sampleFps: number;
  readonly #cellOf: Uint8Array;
  readonly #cellPixels: Float64Array;
  #previous: Uint8Array | undefined;
  readonly samples: MotionSample[] = [];

  public constructor(width: number, height: number, sampleFps: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < gridColumns || height < gridRows) {
      throw new Error("Sample frames are too small for the region grid");
    }
    this.#width = width;
    this.#height = height;
    this.#sampleFps = sampleFps;
    this.#cellOf = new Uint8Array(width * height);
    this.#cellPixels = new Float64Array(cellCount);
    for (let y = 0; y < height; y += 1) {
      const row = Math.min(gridRows - 1, Math.floor((y * gridRows) / height));
      for (let x = 0; x < width; x += 1) {
        const column = Math.min(gridColumns - 1, Math.floor((x * gridColumns) / width));
        const cell = row * gridColumns + column;
        this.#cellOf[y * width + x] = cell;
        this.#cellPixels[cell]! += 1;
      }
    }
  }

  public get frameBytes(): number {
    return this.#width * this.#height;
  }

  public push(frame: Uint8Array): void {
    if (frame.length !== this.frameBytes) throw new Error("Sample frame has the wrong size");
    const regions = new Float32Array(cellCount);
    let global = 0;
    const previous = this.#previous;
    if (previous !== undefined) {
      const sums = new Float64Array(cellCount);
      let total = 0;
      for (let index = 0; index < frame.length; index += 1) {
        const change = Math.abs(frame[index]! - previous[index]!);
        total += change;
        sums[this.#cellOf[index]!]! += change;
      }
      global = total / (frame.length * 255);
      for (let cell = 0; cell < cellCount; cell += 1) regions[cell] = sums[cell]! / (this.#cellPixels[cell]! * 255);
    }
    this.samples.push({ timeMs: Math.round((this.samples.length * 1_000) / this.#sampleFps), global, regions });
    // Keep a copy: the caller may reuse its buffer for the next frame.
    this.#previous = Uint8Array.from(frame);
  }
}

/**
 * Activity of a sample: whole-frame change, or the change concentrated in its
 * four most active cells, whichever is larger. A local hover effect barely
 * moves the frame mean but lights up a few cells, so it still registers.
 */
export function activityOf(sample: MotionSample): number {
  const top = [...sample.regions].sort((a, b) => b - a).slice(0, 4);
  const local = top.reduce((sum, value) => sum + value, 0) / 4;
  return Math.min(1, Math.max(sample.global, local));
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * Adaptive threshold: median + 3 × MAD, so events stand out from ambient motion.
 * Capped at half the clip's peak activity, so a recording that moves almost the
 * whole time (a continuous scroll) still registers its strongest motion, and
 * never below a compression-noise floor.
 */
export function adaptiveThreshold(activity: readonly number[], floor = 0.012): number {
  const center = median(activity);
  const deviation = median(activity.map((value) => Math.abs(value - center)));
  const peak = Math.max(0, ...activity);
  return Math.min(0.5, Math.max(floor, Math.min(center + 3 * deviation, peak * 0.5)));
}

export interface DetectedEvent extends MotionEvent {
  /** Mean per-cell change across the event; used to draw region panels, not stored. */
  readonly regionMeans: number[];
  /**
   * Local maxima inside a long event (strongest first, ≥ 700 ms apart and away
   * from the main peak): the reveals inside a continuous scroll. Not stored.
   */
  readonly subPeaksMs: number[];
}

/** Local maxima of `activity` within [start, end], strongest first, well separated. */
export function subPeaks(activity: readonly number[], start: number, end: number, peakIndex: number, threshold: number, sampleFps: number): number[] {
  const minimumSeparation = Math.max(3, Math.round(0.7 * sampleFps));
  // A reveal stands out from the event's own typical level, not just from silence;
  // a plateau of steady scrolling is not a peak.
  const typical = median(activity.slice(start, end + 1));
  const floor = Math.max(threshold * 1.5, typical * 1.2);
  const candidates: number[] = [];
  for (let index = start + 1; index < end; index += 1) {
    const value = activity[index]!;
    const before = activity[index - 1]!;
    const after = activity[index + 1]!;
    if (value >= floor && value >= before && value >= after && (value > before || value > after)) candidates.push(index);
  }
  const chosen: number[] = [];
  for (const index of candidates.sort((a, b) => activity[b]! - activity[a]!)) {
    if (chosen.length >= 6) break;
    if ([peakIndex, ...chosen].every((other) => Math.abs(other - index) >= minimumSeparation)) chosen.push(index);
  }
  return chosen.map((index) => Math.round((index * 1_000) / sampleFps));
}

export interface EvidenceResult {
  readonly evidence: Omit<ClipEvidence, "bursts">;
  readonly events: DetectedEvent[];
  readonly activity: number[];
}

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

function spreadOf(means: readonly number[]): { spread: number; centroid: { x: number; y: number } } {
  const peak = Math.max(...means);
  if (peak <= 0) return { spread: 0, centroid: { x: 0.5, y: 0.5 } };
  const cellThreshold = Math.max(0.006, peak * 0.25);
  let active = 0;
  let weight = 0;
  let x = 0;
  let y = 0;
  means.forEach((value, cell) => {
    if (value > cellThreshold) active += 1;
    weight += value;
    x += value * ((cell % gridColumns) + 0.5) / gridColumns;
    y += value * (Math.floor(cell / gridColumns) + 0.5) / gridRows;
  });
  return { spread: active / cellCount, centroid: weight > 0 ? { x: x / weight, y: y / weight } : { x: 0.5, y: 0.5 } };
}

/**
 * A band of whole rows touching the top or bottom edge that stayed still while
 * the rest of the frame moved: a hint of a pinned header, footer or sticky bar.
 */
export function stillBandOf(means: readonly number[]): { fromRow: number; toRow: number } | null {
  const rows = Array.from({ length: gridRows }, (_, row) =>
    means.slice(row * gridColumns, (row + 1) * gridColumns).reduce((sum, value) => sum + value, 0) / gridColumns);
  const peak = Math.max(...rows);
  if (peak <= 0) return null;
  const still = rows.map((value) => value < peak * 0.15);
  if (still.every(Boolean) || still.filter((value) => !value).length < 2) return null;
  let top = -1;
  while (top + 1 < gridRows && still[top + 1]) top += 1;
  let bottom = gridRows;
  while (bottom - 1 >= 0 && still[bottom - 1]) bottom -= 1;
  const topBand = top >= 0 ? { fromRow: 0, toRow: top } : null;
  const bottomBand = bottom < gridRows ? { fromRow: bottom, toRow: gridRows - 1 } : null;
  if (topBand === null) return bottomBand;
  if (bottomBand === null) return topBand;
  return topBand.toRow - topBand.fromRow >= bottomBand.toRow - bottomBand.fromRow ? topBand : bottomBand;
}

function localityOf(spread: number): MotionEvent["locality"] {
  return spread >= 0.6 ? "global" : spread >= 0.25 ? "regional" : "local";
}

/** Energy curve, events, cuts and overall region totals for one clip. */
export function analyzeSamples(samples: readonly MotionSample[], sampleFps: number, durationMs: number): EvidenceResult {
  const activity = samples.map(activityOf);
  const threshold = adaptiveThreshold(activity.slice(1));
  const stepMs = 1_000 / sampleFps;
  const mergeGap = Math.max(1, Math.round(300 / stepMs));

  // Runs of active samples, merging short gaps (a wipe that pauses for one sample is one event).
  const runs: Array<[number, number]> = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (activity[index]! <= threshold) continue;
    const last = runs.at(-1);
    if (last !== undefined && index - last[1] <= mergeGap) last[1] = index;
    else runs.push([index, index]);
  }

  const events: DetectedEvent[] = runs.map(([start, end], index) => {
    let peakIndex = start;
    let integral = 0;
    const regionMeans = new Array<number>(cellCount).fill(0);
    for (let sample = start; sample <= end; sample += 1) {
      if (activity[sample]! > activity[peakIndex]!) peakIndex = sample;
      integral += activity[sample]! / sampleFps;
      samples[sample]!.regions.forEach((value, cell) => { regionMeans[cell]! += value / (end - start + 1); });
    }
    const { spread, centroid } = spreadOf(regionMeans);
    // A sample measures change since the previous one, so the event began one step earlier.
    const onsetMs = Math.max(0, Math.round((start - 1) * stepMs));
    const settleMs = Math.min(durationMs, Math.round((end + 1) * stepMs));
    return {
      index,
      onsetMs,
      peakMs: Math.min(durationMs, samples[peakIndex]!.timeMs),
      settleMs: Math.max(settleMs, onsetMs),
      peakEnergy: round(activity[peakIndex]!),
      integral: round(integral),
      spread: round(spread),
      centroid: { x: round(centroid.x), y: round(centroid.y) },
      locality: localityOf(spread),
      stillBand: spread >= 0.25 ? stillBandOf(regionMeans) : null,
      regionMeans: regionMeans.map((value) => round(value)),
      subPeaksMs: end - start >= Math.round(2 * sampleFps) ? subPeaks(activity, start, end, peakIndex, threshold, sampleFps) : [],
    };
  });

  // A cut is a single-sample, whole-frame jump at least 4× both neighbours; a
  // quick fade rises and falls over several samples and is an event instead.
  const cutsMs: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const value = samples[index]!.global;
    const before = samples[index - 1]!.global;
    const after = samples[index + 1]?.global ?? 0;
    if (value >= 0.12 && before <= value * 0.25 && after <= value * 0.25) cutsMs.push(samples[index]!.timeMs);
  }

  const totals = new Array<number>(cellCount).fill(0);
  for (const sample of samples) sample.regions.forEach((value, cell) => { totals[cell]! += value; });
  const totalPeak = Math.max(...totals);
  const meanEnergy = activity.length > 1 ? activity.slice(1).reduce((sum, value) => sum + value, 0) / (activity.length - 1) : 0;

  return {
    activity,
    events,
    evidence: {
      sampleFps: round(sampleFps, 3),
      sampleCount: samples.length,
      gridColumns,
      gridRows,
      threshold: round(threshold),
      meanEnergy: round(Math.min(1, meanEnergy)),
      events: events.map(({ regionMeans: _regionMeans, subPeaksMs: _subPeaks, ...event }) => event),
      cutsMs: cutsMs.slice(0, 200),
      regionTotals: totals.map((value) => (totalPeak > 0 ? round(value / totalPeak) : 0)),
    },
  };
}

export interface KeyframeChoice {
  readonly timeMs: number;
  readonly reason: KeyframeReason;
}

const reasonPriority: Record<KeyframeReason, number> = {
  cut: 7, peak: 6, onset: 5, settle: 4, start: 3, end: 3, fill: 1,
};

/**
 * Smart keyframes: start and end, the frame after every hard cut, then onset /
 * peak / settle for the strongest events, then fill frames so no gap exceeds
 * duration / 8. With no events this degrades to evenly spaced frames.
 */
export function selectKeyframes(
  durationMs: number,
  frameIntervalMs: number,
  events: ReadonlyArray<MotionEvent & { readonly subPeaksMs?: readonly number[] }>,
  cutsMs: readonly number[],
  maximum = maximumKeyframes,
): KeyframeChoice[] {
  const lastMs = Math.max(0, Math.floor(durationMs - Math.max(1, frameIntervalMs)));
  const minimumGap = Math.max(120, durationMs / 80, frameIntervalMs);
  const chosen: KeyframeChoice[] = [];
  const add = (timeMs: number, reason: KeyframeReason): boolean => {
    const clamped = Math.min(lastMs, Math.max(0, Math.round(timeMs)));
    const near = chosen.findIndex((entry) => Math.abs(entry.timeMs - clamped) < minimumGap);
    if (near >= 0) {
      if (reasonPriority[reason] > reasonPriority[chosen[near]!.reason] && chosen[near]!.reason !== "start" && chosen[near]!.reason !== "end") {
        chosen[near] = { timeMs: clamped, reason };
      }
      return false;
    }
    if (chosen.length >= maximum) return false;
    chosen.push({ timeMs: clamped, reason });
    return true;
  };

  add(0, "start");
  add(lastMs, "end");
  for (const cut of cutsMs.slice(0, 6)) add(cut + frameIntervalMs, "cut");
  // Reserve room for coverage frames before spending the budget on events.
  const eventBudget = Math.max(2, maximum - 5);
  const strongest = [...events].sort((a, b) => b.integral - a.integral);
  for (const event of strongest) {
    if (chosen.length + 3 > eventBudget) break;
    add(event.peakMs, "peak");
    add(event.onsetMs, "onset");
    add(event.settleMs, "settle");
  }
  // Then the reveals inside long events, strongest event first.
  for (const event of strongest) {
    for (const peakMs of event.subPeaksMs ?? []) {
      if (chosen.length >= eventBudget) break;
      add(peakMs, "peak");
    }
  }
  const maximumGap = Math.max(minimumGap * 2, durationMs / 8);
  while (chosen.length < maximum) {
    const sorted = [...chosen].sort((a, b) => a.timeMs - b.timeMs);
    let widest = -1;
    let widestGap = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = sorted[index]!.timeMs - sorted[index - 1]!.timeMs;
      if (gap > widestGap) { widestGap = gap; widest = index; }
    }
    if (widest < 0 || widestGap <= maximumGap) break;
    const midpoint = (sorted[widest - 1]!.timeMs + sorted[widest]!.timeMs) / 2;
    if (!add(midpoint, "fill")) break;
  }
  return chosen.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Burst strips for the strongest events: up to eight frames from just before
 * onset to settle, at least one native frame apart, so a fast wipe can be read.
 */
export function selectBursts(
  events: readonly MotionEvent[],
  durationMs: number,
  frameIntervalMs: number,
  sampleIntervalMs: number,
): MotionBurst[] {
  const lastMs = Math.max(0, Math.floor(durationMs - Math.max(1, frameIntervalMs)));
  return [...events]
    .sort((a, b) => b.integral - a.integral)
    .slice(0, maximumBursts)
    .sort((a, b) => a.onsetMs - b.onsetMs)
    .map((event, index) => {
      const startMs = Math.max(0, Math.round(event.onsetMs - sampleIntervalMs));
      const endMs = Math.min(lastMs, Math.max(startMs, event.settleMs));
      const span = endMs - startMs;
      const count = Math.max(2, Math.min(burstFrameCount, Math.floor(span / Math.max(1, frameIntervalMs)) + 1));
      const frameTimesMs = [...new Set(Array.from({ length: count }, (_, frame) =>
        Math.min(lastMs, Math.round(startMs + (span * frame) / (count - 1)))))];
      if (frameTimesMs.length < 2) frameTimesMs.push(Math.min(lastMs, frameTimesMs[0]! + Math.max(1, Math.round(frameIntervalMs))));
      return { index, eventIndex: event.index, startMs, endMs, frameTimesMs };
    });
}

/** `mm:ss.cc` for labels. */
export function timecode(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const secondsPart = (total % 60_000) / 1_000;
  return `${String(minutes).padStart(2, "0")}:${secondsPart.toFixed(2).padStart(5, "0")}`;
}
