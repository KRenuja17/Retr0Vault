import { describe, expect, it } from "vitest";

import {
  activityOf,
  adaptiveThreshold,
  analyzeSamples,
  cellCount,
  gridColumns,
  MotionSampler,
  selectBursts,
  selectKeyframes,
  stillBandOf,
  timecode,
  type MotionSample,
} from "../src/motion/analyzer.js";
import { parseByteRange } from "../src/routes/motion.js";

const fps = 10;

/** A sample whose change is `value` in the given cells and zero elsewhere. */
function sample(index: number, value: number, cells: readonly number[] = Array.from({ length: cellCount }, (_, cell) => cell)): MotionSample {
  const regions = new Float32Array(cellCount);
  for (const cell of cells) regions[cell] = value;
  return { timeMs: Math.round((index * 1_000) / fps), global: (value * cells.length) / cellCount, regions };
}

function series(values: ReadonlyArray<number | [number, readonly number[]]>): MotionSample[] {
  return values.map((entry, index) => Array.isArray(entry) ? sample(index, entry[0], entry[1]) : sample(index, entry as number));
}

describe("motion sampler", () => {
  it("reports no change for identical frames and localizes a changed region", () => {
    const sampler = new MotionSampler(16, 12, fps);
    const blank = new Uint8Array(16 * 12).fill(100);
    sampler.push(blank);
    sampler.push(blank);
    const changed = Uint8Array.from(blank);
    // Top-left 2 × 2 pixels = exactly cell 0 of the 8 × 6 grid.
    for (const index of [0, 1, 16, 17]) changed[index] = 255;
    sampler.push(changed);

    expect(sampler.samples.map((entry) => entry.timeMs)).toEqual([0, 100, 200]);
    expect(sampler.samples[1]!.global).toBe(0);
    expect(sampler.samples[2]!.regions[0]).toBeCloseTo(155 / 255, 5);
    expect([...sampler.samples[2]!.regions].slice(1).every((value) => value === 0)).toBe(true);
    expect(sampler.samples[2]!.global).toBeCloseTo((4 * 155) / (192 * 255), 5);
  });

  it("rejects frames of the wrong size and grids too small to divide", () => {
    expect(() => new MotionSampler(4, 4, fps)).toThrow();
    const sampler = new MotionSampler(16, 12, fps);
    expect(() => sampler.push(new Uint8Array(10))).toThrow();
  });
});

describe("activity and threshold", () => {
  it("lets a local effect register through its most active cells", () => {
    const local = sample(1, 0.4, [10, 11, 18, 19]);
    expect(local.global).toBeLessThan(0.05);
    expect(activityOf(local)).toBeCloseTo(0.4, 5);
  });

  it("never drops below the compression-noise floor", () => {
    expect(adaptiveThreshold([0, 0, 0, 0])).toBe(0.012);
    expect(adaptiveThreshold([0.1, 0.1, 0.1, 0.5])).toBeGreaterThanOrEqual(0.1);
  });
});

describe("event detection", () => {
  it("finds no events in a static recording", () => {
    const result = analyzeSamples(series(Array(30).fill(0.001)), fps, 3_000);
    expect(result.evidence.events).toEqual([]);
    expect(result.evidence.cutsMs).toEqual([]);
    expect(result.evidence.regionTotals).toHaveLength(48);
  });

  it("records onset, peak and settle of a global move", () => {
    const values = [0, 0, 0, 0, 0.05, 0.2, 0.4, 0.2, 0.05, 0, 0, 0, 0];
    const result = analyzeSamples(series(values), fps, 1_300);
    expect(result.evidence.events).toHaveLength(1);
    const [event] = result.evidence.events;
    expect(event).toMatchObject({ onsetMs: 300, peakMs: 600, settleMs: 900, locality: "global" });
    expect(event!.spread).toBe(1);
    expect(event!.integral).toBeCloseTo(0.09, 5);
  });

  it("merges a short pause into one event and separates distant ones", () => {
    const values = [0, 0.1, 0.1, 0, 0.1, 0.1, 0, 0, 0, 0, 0, 0.1, 0.1, 0];
    const result = analyzeSamples(series(values), fps, 1_400);
    expect(result.evidence.events.map((event) => [event.onsetMs, event.settleMs])).toEqual([[0, 600], [1_000, 1_300]]);
  });

  it("classifies a small moving element as local and reports its centroid", () => {
    const cells = [5, 6, 13, 14];
    const values: Array<[number, readonly number[]]> = [[0, cells], [0.3, cells], [0.3, cells], [0, cells], [0, cells]];
    const [event] = analyzeSamples(series(values), fps, 500).evidence.events;
    expect(event!.locality).toBe("local");
    expect(event!.spread).toBeCloseTo(4 / 48, 4);
    expect(event!.centroid.x).toBeCloseTo(6 / gridColumns, 4);
    expect(event!.centroid.y).toBeCloseTo(1 / 6, 4);
    expect(event!.stillBand).toBeNull();
  });

  it("hints at a pinned band when edge rows stay still while the rest moves", () => {
    const moving = Array.from({ length: cellCount }, (_, cell) => cell).filter((cell) => cell >= gridColumns);
    const values: Array<[number, readonly number[]]> = [[0, moving], [0.2, moving], [0.2, moving], [0, moving]];
    const [event] = analyzeSamples(series(values), fps, 400).evidence.events;
    expect(event!.locality).toBe("global");
    expect(event!.stillBand).toEqual({ fromRow: 0, toRow: 0 });
  });

  it("detects a hard cut as an isolated whole-frame spike", () => {
    const values = [0, 0, 0, 0.6, 0, 0, 0.05, 0.06, 0.05, 0.06, 0];
    const result = analyzeSamples(series(values), fps, 1_100);
    expect(result.evidence.cutsMs).toEqual([300]);
  });

  it("does not call steady fast scrolling a cut", () => {
    const result = analyzeSamples(series([0, 0.3, 0.32, 0.31, 0.3, 0.33, 0]), fps, 700);
    expect(result.evidence.cutsMs).toEqual([]);
    expect(result.evidence.events).toHaveLength(1);
  });
});

describe("still band", () => {
  it("returns null when nothing or everything moves", () => {
    expect(stillBandOf(new Array(cellCount).fill(0))).toBeNull();
    expect(stillBandOf(new Array(cellCount).fill(0.2))).toBeNull();
  });

  it("prefers the larger of top and bottom bands", () => {
    const means = new Array(cellCount).fill(0.2);
    for (let cell = 0; cell < gridColumns; cell += 1) means[cell] = 0;
    for (let cell = 4 * gridColumns; cell < cellCount; cell += 1) means[cell] = 0;
    expect(stillBandOf(means)).toEqual({ fromRow: 4, toRow: 5 });
  });
});

describe("smart keyframes", () => {
  it("degrades to evenly spaced frames for a static clip", () => {
    const keyframes = selectKeyframes(8_000, 33, [], []);
    expect(keyframes[0]).toEqual({ timeMs: 0, reason: "start" });
    expect(keyframes.at(-1)!.reason).toBe("end");
    expect(keyframes.filter((keyframe) => keyframe.reason === "fill").length).toBeGreaterThanOrEqual(6);
    const gaps = keyframes.slice(1).map((keyframe, index) => keyframe.timeMs - keyframes[index]!.timeMs);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1_000);
  });

  it("covers every event and the frame after each cut, in time order and within the clip", () => {
    const { evidence } = analyzeSamples(series([0, 0, 0, 0.6, 0, 0, 0, 0, 0.1, 0.3, 0.1, 0, 0, 0, 0]), fps, 1_500);
    const keyframes = selectKeyframes(1_500, 33, evidence.events, evidence.cutsMs);
    const reasons = keyframes.map((keyframe) => keyframe.reason);
    expect(reasons).toEqual(expect.arrayContaining(["start", "cut", "onset", "peak", "settle", "end"]));
    expect(keyframes.map((keyframe) => keyframe.timeMs)).toEqual([...keyframes.map((keyframe) => keyframe.timeMs)].sort((a, b) => a - b));
    expect(keyframes.every((keyframe) => keyframe.timeMs >= 0 && keyframe.timeMs < 1_500)).toBe(true);
  });

  it("never exceeds the budget however many events there are", () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      index, onsetMs: index * 1_400, peakMs: index * 1_400 + 300, settleMs: index * 1_400 + 700,
      peakEnergy: 0.3, integral: 1 + index, spread: 1, centroid: { x: 0.5, y: 0.5 }, locality: "global" as const, stillBand: null,
    }));
    const keyframes = selectKeyframes(60_000, 16, events, [], 24);
    expect(keyframes.length).toBeLessThanOrEqual(24);
    // The strongest events are covered first.
    expect(keyframes.some((keyframe) => keyframe.timeMs === 39 * 1_400 + 300)).toBe(true);
  });
});

describe("burst selection", () => {
  it("spans the strongest events with up to eight distinct frames", () => {
    const events = [
      { index: 0, onsetMs: 1_000, peakMs: 1_200, settleMs: 1_600, peakEnergy: 0.2, integral: 0.2, spread: 1, centroid: { x: 0.5, y: 0.5 }, locality: "global" as const, stillBand: null },
      { index: 1, onsetMs: 3_000, peakMs: 3_050, settleMs: 3_100, peakEnergy: 0.2, integral: 0.05, spread: 0.1, centroid: { x: 0.5, y: 0.5 }, locality: "local" as const, stillBand: null },
    ];
    const bursts = selectBursts(events, 5_000, 1_000 / 30, 100);
    expect(bursts.map((burst) => burst.eventIndex)).toEqual([0, 1]);
    expect(bursts[0]!.frameTimesMs).toHaveLength(8);
    expect(bursts[0]!.startMs).toBe(900);
    expect(bursts[0]!.frameTimesMs.at(-1)).toBe(1_600);
    // A 200 ms event at 30 fps still yields distinct frames, one native frame apart at least.
    const short = bursts[1]!.frameTimesMs;
    expect(new Set(short).size).toBe(short.length);
    expect(short.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps at most four bursts", () => {
    const events = Array.from({ length: 9 }, (_, index) => ({
      index, onsetMs: index * 1_000, peakMs: index * 1_000 + 100, settleMs: index * 1_000 + 300,
      peakEnergy: 0.2, integral: index, spread: 1, centroid: { x: 0.5, y: 0.5 }, locality: "global" as const, stillBand: null,
    }));
    expect(selectBursts(events, 10_000, 33, 100).map((burst) => burst.eventIndex)).toEqual([5, 6, 7, 8]);
  });
});

describe("helpers", () => {
  it("formats timecodes", () => {
    expect(timecode(0)).toBe("00:00.00");
    expect(timecode(4_205)).toBe("00:04.21");
    expect(timecode(61_500)).toBe("01:01.50");
  });

  it("parses single byte ranges and rejects unsatisfiable ones", () => {
    expect(parseByteRange(undefined, 1_000)).toBeUndefined();
    expect(parseByteRange("bytes=0-99", 1_000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=900-", 1_000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-100", 1_000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=0-5000", 1_000)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange("bytes=1000-", 1_000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=50-10", 1_000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-1,5-9", 1_000)).toBeUndefined();
    expect(parseByteRange("items=0-1", 1_000)).toBeUndefined();
  });
});
