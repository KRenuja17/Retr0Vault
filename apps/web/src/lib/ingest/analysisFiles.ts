/** The backend validates at most 100 analyses per import request. */
export const MAX_ANALYSES_PER_IMPORT = 100;

export interface AnalysisEntry {
  /** The file the object came from, used to name it in the import report. */
  readonly label: string;
  readonly value: unknown;
}

export interface AnalysisFileRead {
  readonly entries: readonly AnalysisEntry[];
  /** Files that were not readable JSON; reported without blocking the rest. */
  readonly rejected: readonly string[];
}

/**
 * Reads dropped or chosen analysis files into a flat list of candidate
 * objects. A file may hold one analysis or an array of them — Claude Code and
 * Codex are asked for one file per reference, but a single combined file is a
 * reasonable thing for a curator to hand back, so both are accepted.
 *
 * Nothing here validates the analysis itself: the backend parses every entry
 * against the shared schema and reports each one separately.
 */
export async function readAnalysisFiles(
  files: readonly File[],
): Promise<AnalysisFileRead> {
  const entries: AnalysisEntry[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text()) as unknown;
    } catch {
      rejected.push(`${file.name} — not valid JSON`);
      continue;
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        rejected.push(`${file.name} — holds an empty list`);
        continue;
      }
      parsed.forEach((value, index) => {
        entries.push({ label: `${file.name}[${index}]`, value });
      });
      continue;
    }

    if (typeof parsed !== "object" || parsed === null) {
      rejected.push(`${file.name} — is not an analysis object`);
      continue;
    }

    entries.push({ label: file.name, value: parsed });
  }

  return { entries, rejected };
}

/**
 * Offers a JSON document to the browser as a download. Falls back to a data
 * URL where object URLs are unavailable, and reports failure rather than
 * pretending the file was saved.
 */
export function downloadJson(filename: string, payload: unknown): boolean {
  if (typeof document === "undefined") return false;

  const serialised = `${JSON.stringify(payload, null, 2)}\n`;
  const supportsObjectUrl =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
  const href = supportsObjectUrl
    ? URL.createObjectURL(new Blob([serialised], { type: "application/json" }))
    : `data:application/json;charset=utf-8,${encodeURIComponent(serialised)}`;

  try {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } catch {
    return false;
  } finally {
    // Revoking in the same tick can cancel the save the click just started, so
    // the handle is released once the event loop has drained.
    if (supportsObjectUrl) {
      setTimeout(() => URL.revokeObjectURL(href), 0);
    }
  }
}
