import sharp, { type OverlayOptions } from "sharp";

import type { ClipEvidence, KeyframeReason, MotionBurst } from "@retr0vault/shared";

import { cellCount, gridColumns, gridRows, timecode, type DetectedEvent } from "./analyzer.js";

/*
 * Evidence sheets for the curator. They use the archive's own paper, ink and
 * terracotta so an exported sheet reads as part of Retr0Vault, and every label
 * is plain monospace text rendered from SVG by sharp.
 */

const paper = "#f1ece5";
const surface = "#fbf8f3";
const ink = "#17140f";
const muted = "#766a5d";
const hairline = "#d7cdbf";
const accent = "#b4472a";
const font = "Consolas, 'JetBrains Mono', 'Courier New', monospace";

function escape(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

async function svgToWebp(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer();
}

async function labelStrip(width: number, height: number, lines: readonly string[], size = 14): Promise<Buffer> {
  const text = lines.map((line, index) =>
    `<text x="8" y="${18 + index * (size + 4)}" font-family="${font}" font-size="${size}" fill="${index === 0 ? ink : muted}">${escape(line)}</text>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${surface}"/>${text}</svg>`))
    .png().toBuffer();
}

export interface TimelineInput {
  readonly label: string;
  readonly durationMs: number;
  readonly activity: readonly number[];
  readonly evidence: Omit<ClipEvidence, "bursts">;
  readonly keyframes: ReadonlyArray<{ timeMs: number; reason: KeyframeReason }>;
}

const reasonMark: Record<KeyframeReason, string> = {
  start: "S", onset: "O", peak: "P", settle: "T", cut: "C", fill: "·", end: "E",
};

/** The motion-energy curve on a time axis, event windows shaded, keyframes ticked. */
export async function renderEnergyTimeline(input: TimelineInput): Promise<Buffer> {
  const width = 1600;
  const height = 380;
  const left = 64;
  const right = 24;
  const top = 64;
  const bottom = 86;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const duration = Math.max(1, input.durationMs);
  const scaleMax = Math.max(input.evidence.threshold * 2, ...input.activity, 0.02);
  const x = (ms: number) => left + (Math.min(duration, Math.max(0, ms)) / duration) * plotWidth;
  const y = (value: number) => top + plotHeight - (Math.min(scaleMax, value) / scaleMax) * plotHeight;
  const stepMs = 1_000 / input.evidence.sampleFps;

  const events = input.evidence.events.map((event) =>
    `<rect x="${x(event.onsetMs).toFixed(1)}" y="${top}" width="${Math.max(2, x(event.settleMs) - x(event.onsetMs)).toFixed(1)}" height="${plotHeight}" fill="${accent}" fill-opacity="0.12"/>` +
    `<text x="${(x(event.onsetMs) + 3).toFixed(1)}" y="${top + 14}" font-family="${font}" font-size="12" fill="${accent}">E${event.index + 1} ${event.locality.toUpperCase()}</text>`).join("");
  const cuts = input.evidence.cutsMs.map((cut) =>
    `<line x1="${x(cut).toFixed(1)}" x2="${x(cut).toFixed(1)}" y1="${top}" y2="${top + plotHeight}" stroke="${ink}" stroke-width="2" stroke-dasharray="2 3"/>`).join("");
  const points = input.activity.map((value, index) => `${x(index * stepMs).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const threshold = y(input.evidence.threshold);

  const tickEvery = duration <= 12_000 ? 1_000 : duration <= 30_000 ? 2_000 : 5_000;
  const ticks: string[] = [];
  for (let ms = 0; ms <= duration; ms += tickEvery) {
    ticks.push(`<line x1="${x(ms).toFixed(1)}" x2="${x(ms).toFixed(1)}" y1="${top + plotHeight}" y2="${top + plotHeight + 6}" stroke="${ink}"/>` +
      `<text x="${x(ms).toFixed(1)}" y="${top + plotHeight + 22}" text-anchor="middle" font-family="${font}" font-size="12" fill="${muted}">${timecode(ms).slice(0, 5)}</text>`);
  }
  const keyframeTicks = input.keyframes.map((keyframe, index) =>
    `<line x1="${x(keyframe.timeMs).toFixed(1)}" x2="${x(keyframe.timeMs).toFixed(1)}" y1="${top + plotHeight + 30}" y2="${top + plotHeight + 42}" stroke="${keyframe.reason === "fill" ? muted : accent}" stroke-width="2"/>` +
    `<text x="${x(keyframe.timeMs).toFixed(1)}" y="${top + plotHeight + 56}" text-anchor="middle" font-family="${font}" font-size="11" fill="${ink}">${reasonMark[keyframe.reason]}${index}</text>`).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${paper}"/>
<text x="${left}" y="26" font-family="${font}" font-size="16" fill="${ink}">MOTION ENERGY — ${escape(input.label.toUpperCase())} · ${timecode(input.durationMs)} · ${input.evidence.sampleFps} FPS SAMPLES</text>
<text x="${left}" y="46" font-family="${font}" font-size="12" fill="${muted}">change per sample (whole frame or its 4 most active cells) · shaded = event · dashed = hard cut · ticks = keyframes (S start O onset P peak T settle C cut · fill E end)</text>
<rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="${surface}" stroke="${hairline}"/>
${events}${cuts}
<line x1="${left}" x2="${left + plotWidth}" y1="${threshold.toFixed(1)}" y2="${threshold.toFixed(1)}" stroke="${muted}" stroke-dasharray="6 4"/>
<text x="${left - 6}" y="${(threshold + 4).toFixed(1)}" text-anchor="end" font-family="${font}" font-size="11" fill="${muted}">thr</text>
<polyline points="${points}" fill="none" stroke="${ink}" stroke-width="1.6"/>
<line x1="${left}" x2="${left + plotWidth}" y1="${top + plotHeight}" y2="${top + plotHeight}" stroke="${ink}"/>
${ticks.join("")}${keyframeTicks}
</svg>`;
  return svgToWebp(svg);
}

function heatOverlay(width: number, height: number, values: readonly number[]): string {
  const peak = Math.max(...values, 0);
  const cellWidth = width / gridColumns;
  const cellHeight = height / gridRows;
  let cells = "";
  for (let cell = 0; cell < cellCount; cell += 1) {
    const value = peak > 0 ? values[cell]! / peak : 0;
    const column = cell % gridColumns;
    const row = Math.floor(cell / gridColumns);
    cells += `<rect x="${(column * cellWidth).toFixed(1)}" y="${(row * cellHeight).toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${cellHeight.toFixed(1)}" fill="${accent}" fill-opacity="${(Math.pow(value, 1.6) * 0.75).toFixed(3)}" stroke="${surface}" stroke-opacity="0.35" stroke-width="1"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${cells}</svg>`;
}

async function heatPanel(poster: Buffer, width: number, values: readonly number[]): Promise<Buffer> {
  // Greyscale base so the terracotta heat is the only colour on the panel.
  const base = await sharp(poster).resize({ width }).greyscale().toColourspace("srgb").png().toBuffer();
  const { width: resizedWidth = width, height = Math.round(width * 0.625) } = await sharp(base).metadata();
  return sharp(base)
    .composite([{ input: Buffer.from(heatOverlay(resizedWidth, height, values)), top: 0, left: 0 }])
    .png().toBuffer();
}

/** Poster with the overall change heat map, plus one small panel per event. */
export async function renderRegionSheet(
  poster: Buffer,
  evidence: Omit<ClipEvidence, "bursts">,
  events: readonly DetectedEvent[],
  label: string,
): Promise<Buffer> {
  const mainWidth = 960;
  const main = await heatPanel(poster, mainWidth, evidence.regionTotals);
  const mainHeight = (await sharp(main).metadata()).height!;
  const shown = [...events].sort((a, b) => b.integral - a.integral).slice(0, 8).sort((a, b) => a.onsetMs - b.onsetMs);
  const panelWidth = 300;
  const panelHeight = Math.round((panelWidth * mainHeight) / mainWidth);
  const captionHeight = 44;
  const columns = 3;
  const rows = Math.ceil(shown.length / columns);
  const header = 48;
  const width = mainWidth + 24 + (shown.length > 0 ? columns * (panelWidth + 12) : 0) + 12;
  const height = Math.max(header + mainHeight + 56, header + rows * (panelHeight + captionHeight + 12)) + 12;

  const composites: OverlayOptions[] = [
    { input: await labelStrip(width, header, [`REGION MAP — ${label.toUpperCase()}`, "where the picture changed · 8 × 6 grid · darker terracotta = more change (computed hint)"]), top: 0, left: 0 },
    { input: main, top: header, left: 12 },
    { input: await labelStrip(mainWidth, 44, ["WHOLE CLIP", `mean energy ${evidence.meanEnergy.toFixed(3)} · ${evidence.events.length} events · ${evidence.cutsMs.length} cuts`]), top: header + mainHeight + 4, left: 12 },
  ];
  for (const [position, event] of shown.entries()) {
    const panel = await heatPanel(poster, panelWidth, event.regionMeans);
    const left = mainWidth + 24 + (position % columns) * (panelWidth + 12);
    const top = header + Math.floor(position / columns) * (panelHeight + captionHeight + 12);
    composites.push({ input: panel, top, left });
    composites.push({
      input: await labelStrip(panelWidth, captionHeight, [
        `E${event.index + 1} ${timecode(event.onsetMs)}–${timecode(event.settleMs)}`,
        `spread ${event.spread.toFixed(2)} · ${event.locality}${event.stillBand ? ` · still rows ${event.stillBand.fromRow}–${event.stillBand.toRow}` : ""}`,
      ], 12),
      top: top + panelHeight,
      left,
    });
  }
  return sharp({ create: { width, height, channels: 3, background: paper } }).composite(composites).webp({ quality: 86 }).toBuffer();
}

export interface SheetFrame {
  readonly image: Buffer;
  readonly timeMs: number;
  readonly caption: string;
}

async function frameGrid(title: readonly string[], frames: readonly SheetFrame[], columns: number, frameWidth: number): Promise<Buffer> {
  const resized = await Promise.all(frames.map((frame) => sharp(frame.image).resize({ width: frameWidth }).png().toBuffer()));
  const frameHeight = resized.length > 0 ? (await sharp(resized[0]!).metadata()).height! : Math.round(frameWidth * 0.625);
  const captionHeight = 26;
  const header = 48;
  const gap = 10;
  const rows = Math.max(1, Math.ceil(frames.length / columns));
  const width = columns * (frameWidth + gap) + gap;
  const height = header + rows * (frameHeight + captionHeight + gap) + gap;
  const composites: OverlayOptions[] = [{ input: await labelStrip(width, header, title), top: 0, left: 0 }];
  for (const [index, frame] of frames.entries()) {
    const left = gap + (index % columns) * (frameWidth + gap);
    const top = header + Math.floor(index / columns) * (frameHeight + captionHeight + gap);
    composites.push({ input: resized[index]!, top, left });
    composites.push({ input: await labelStrip(frameWidth, captionHeight, [`${timecode(frame.timeMs)}  ${frame.caption}`], 13), top: top + frameHeight, left });
  }
  return sharp({ create: { width, height, channels: 3, background: paper } }).composite(composites).webp({ quality: 86 }).toBuffer();
}

/** All keyframes in time order, each captioned with its timecode and reason. */
export function renderContactSheet(label: string, frames: readonly SheetFrame[]): Promise<Buffer> {
  return frameGrid([`CONTACT SHEET — ${label.toUpperCase()}`, "smart keyframes in time order · reason = why the frame was chosen"], frames, 4, 360);
}

/** One strip of consecutive frames across an event. */
export function renderBurstStrip(label: string, burst: MotionBurst, event: DetectedEvent | undefined, frames: readonly SheetFrame[]): Promise<Buffer> {
  const describe = event === undefined ? "" : ` · ${event.locality} · spread ${event.spread.toFixed(2)}`;
  return frameGrid([
    `BURST ${burst.index + 1} — ${label.toUpperCase()} · E${burst.eventIndex + 1} ${timecode(burst.startMs)}–${timecode(burst.endMs)}`,
    `${frames.length} frames across the transition, read left to right${describe}`,
  ], frames, Math.min(4, Math.max(2, frames.length)), 300);
}
