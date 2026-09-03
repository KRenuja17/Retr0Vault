import type { AuthoredDirection } from "@retr0vault/shared";

import { API_BASE_URL, ApiError } from "./client";

/*
 * The export routes are the one part of the API that does not answer JSON:
 * they return a UTF-8 Markdown attachment, and only a failure carries the
 * error envelope. `apiRequest` parses every success as JSON, so these routes
 * get their own entry point rather than a flag threaded through that one.
 *
 * Markdown generation belongs to the backend. Nothing here builds a document;
 * it only carries the selection there and the file back.
 */

export interface DownloadedFile {
  /** The server's own `Content-Disposition` name, content-hashed and stable. */
  readonly filename: string;
  readonly text: string;
}

const FILENAME = /filename="([^"]+)"/u;

function isErrorEnvelope(
  value: unknown,
): value is { error: { code: string; message: string; statusCode: number } } {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

async function postForMarkdown(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<DownloadedFile> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/markdown",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError(
      "Retr0Vault could not reach the local API on 127.0.0.1:4611.",
      { code: "NETWORK_UNREACHABLE", statusCode: 0, cause },
    );
  }

  const raw = await response.text();

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      payload = undefined;
    }
    if (isErrorEnvelope(payload)) {
      throw new ApiError(payload.error.message, {
        code: payload.error.code,
        statusCode: payload.error.statusCode,
      });
    }
    /*
     * A 5xx without the envelope did not come from the API: it came from the
     * dev proxy in front of it, which could not connect. Reported the same way
     * the JSON client reports it, so both read as "nothing is listening".
     */
    if (response.status >= 500) {
      throw new ApiError(
        "Retr0Vault could not reach the local API on 127.0.0.1:4611.",
        { code: "UPSTREAM_UNREACHABLE", statusCode: response.status },
      );
    }
    throw new ApiError(`Export failed with status ${response.status}.`, {
      code: "REQUEST_FAILED",
      statusCode: response.status,
    });
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const matched = FILENAME.exec(disposition);
  return { filename: matched?.[1] ?? fallbackName, text: raw };
}

/**
 * Selected reference briefs, as one combined Markdown document in selection
 * order: DNA, thesis, vocabulary, the available analysis dimensions, the
 * design brief, the image recipe and the motion/asset briefs.
 */
export function exportReferenceBriefs(
  referenceIds: readonly string[],
): Promise<DownloadedFile> {
  return postForMarkdown(
    "/export/references",
    { mode: "references", referenceIds: [...referenceIds] },
    "retr0vault-references.md",
  );
}

/** Only the selected references' vocabulary, deduplicated by the backend. */
export function exportVocabulary(
  referenceIds: readonly string[],
): Promise<DownloadedFile> {
  return postForMarkdown(
    "/export/references",
    { mode: "vocabulary", referenceIds: [...referenceIds] },
    "retr0vault-vocabulary.md",
  );
}

/**
 * The combination manifest an external curator processes: the selected
 * sources, the comparison instructions, and the JSON Schema for the result.
 * The first selected reference is the starting point, not blanket authority.
 */
export function exportPendingCombination(
  referenceIds: readonly string[],
  intent?: string,
): Promise<DownloadedFile> {
  const trimmed = intent?.trim() ?? "";
  return postForMarkdown(
    "/export/design-direction",
    {
      mode: "pending-combination",
      referenceIds: [...referenceIds],
      ...(trimmed.length > 0 ? { intent: trimmed } : {}),
    },
    "retr0vault-pending-combination.md",
  );
}

/**
 * A direction the curator has authored, formatted as Markdown. The endpoint
 * validates and formats the supplied decisions; it neither generates nor
 * evaluates them, and it does not persist the direction.
 */
export function exportAuthoredDirection(
  referenceIds: readonly string[],
  direction: AuthoredDirection,
): Promise<DownloadedFile> {
  return postForMarkdown(
    "/export/design-direction",
    { mode: "authored", referenceIds: [...referenceIds], direction },
    "retr0vault-direction.md",
  );
}

/**
 * Hands a generated document to the browser as a download. Split out so the
 * calling views stay testable: everything above returns the file, and only
 * this touches the DOM.
 */
export function saveMarkdown(file: DownloadedFile): void {
  const blob = new Blob([file.text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
