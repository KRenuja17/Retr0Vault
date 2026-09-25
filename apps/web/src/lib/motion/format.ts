import type { KeyframeReason, MotionTrigger } from "@retr0vault/shared";

/** `mm:ss` for plate overlays; `mm:ss.cc` when precision matters (beats, evidence). */
export function timecode(ms: number | null | undefined, precise = false): string {
  const total = Math.max(0, Math.round(ms ?? 0));
  const minutes = Math.floor(total / 60_000);
  const seconds = (total % 60_000) / 1_000;
  const secondsText = precise ? seconds.toFixed(2).padStart(5, "0") : String(Math.floor(seconds)).padStart(2, "0");
  return `${String(minutes).padStart(2, "0")}:${secondsText}`;
}

/** Filter-rail and card labels, in the archive's mono uppercase vocabulary. */
export const TRIGGER_LABELS: Readonly<Record<MotionTrigger, string>> = {
  load: "Load",
  time: "Time",
  scroll: "Scroll",
  wheel: "Wheel",
  cursor: "Cursor",
  hover: "Hover",
  click: "Click",
  pinned: "Pinned",
  unknown: "Unknown",
};

/** Triggers shown on the rail; `unknown` is listed only when something uses it. */
export const RAIL_TRIGGERS: readonly MotionTrigger[] = [
  "load", "time", "scroll", "wheel", "cursor", "hover", "click", "pinned",
];

export const REASON_LABELS: Readonly<Record<KeyframeReason, string>> = {
  start: "Start",
  onset: "Onset",
  peak: "Peak",
  settle: "Settle",
  cut: "Cut",
  fill: "Fill",
  end: "End",
};

export function isMotionTrigger(value: string | null): value is MotionTrigger {
  return value !== null && Object.hasOwn(TRIGGER_LABELS, value);
}
