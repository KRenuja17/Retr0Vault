import { ApiError } from "@/lib/api/client";

export interface IngestFailure {
  /** The archive's own one-line account of what went wrong. */
  readonly headline: string;
  /** What the API said, or the local reason when nothing was sent. */
  readonly detail: string;
  /** What to do about it, when there is something specific to do. */
  readonly hint: string | undefined;
  /** `CODE · 415`, for the marginalia line. Absent for local failures. */
  readonly signature: string | undefined;
}

export type IngestSubject =
  | "upload"
  | "capture"
  | "import"
  | "update"
  | "reset"
  | "read"
  | "recording"
  | "replace";

const HEADLINES: Record<IngestSubject, string> = {
  upload: "That plate was not filed",
  capture: "That site was not captured",
  import: "The analysis was not imported",
  update: "Those edits were not saved",
  reset: "That reference was not reset",
  read: "The archive could not be read",
  recording: "That recording was not filed",
  replace: "That picture was not replaced",
};

/** Subjects that change the archive, and can therefore leave nothing behind. */
const WRITES: ReadonlySet<IngestSubject> = new Set<IngestSubject>([
  "upload",
  "capture",
  "import",
  "update",
  "reset",
  "recording",
  "replace",
]);

/*
 * Hints are added only where the API's message cannot carry the fix: a stopped
 * process, a browser that was never installed, a capture already running. Every
 * other message from the backend is already the plain explanation, so it is
 * shown as-is rather than paraphrased into something less accurate.
 */
const HINTS: Record<string, string> = {
  CAPTURE_BROWSER_UNAVAILABLE:
    "Chromium is not installed for capture. Run npm run capture:install, then try the address again.",
  CAPTURE_BUSY:
    "Only one capture runs at a time. Wait for the current one to finish and submit again.",
  CAPTURE_TIMEOUT:
    "Nothing was saved. Slow or heavily scripted pages often need a second attempt.",
  UPLOAD_TOO_LARGE:
    "Nothing was stored. Export a smaller version of the image and file that instead.",
  DESIGN_TYPE_NOT_FOUND:
    "The design type has been removed since this page loaded. Reload and pick another.",
  DATABASE_BUSY: "Another Retr0Vault process is writing. Try again in a moment.",
  REFERENCE_IMAGE_BUSY:
    "This reference's picture is already being replaced. Wait for that to finish and try again.",
  MOTION_TOOLS_UNAVAILABLE:
    "Run npm approve-scripts ffmpeg-static and npm rebuild ffmpeg-static, or set FFMPEG_PATH and FFPROBE_PATH, then restart the API.",
  MOTION_CLIP_LIMIT:
    "A motion study holds four recordings. Remove one from the motion sheet before adding another.",
  UNSUPPORTED_MEDIA:
    "Nothing was stored. Export the recording as MP4 (H.264) from your screen recorder and try again.",
  MOTION_OUT_OF_LIMITS:
    "Nothing was stored. Trim the recording to 60 seconds or less, at most 3840 × 2160.",
};

export function describeIngestFailure(
  error: unknown,
  subject: IngestSubject,
): IngestFailure {
  if (error instanceof ApiError && error.isOffline) {
    return {
      headline: "The archive is not answering",
      // Only a write can have left something half-done, so only a write says so.
      detail: `Retr0Vault could not reach the local API on 127.0.0.1:4611.${
        WRITES.has(subject) ? " Nothing was stored." : ""
      }`,
      hint: "Start it with npm run dev:api, then try again.",
      signature: undefined,
    };
  }

  if (error instanceof ApiError) {
    return {
      headline: HEADLINES[subject],
      detail: error.message,
      hint: HINTS[error.code],
      signature: `${error.code} · ${error.statusCode}${
        error.requestId ? ` · request ${error.requestId}` : ""
      }`,
    };
  }

  return {
    headline: HEADLINES[subject],
    detail:
      error instanceof Error
        ? error.message
        : "Something failed between the browser and the local API.",
    hint: undefined,
    signature: undefined,
  };
}
