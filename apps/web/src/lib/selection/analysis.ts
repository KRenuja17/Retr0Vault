import type { ReferenceResponse } from "@retr0vault/shared";

/**
 * Reading the internal analysis a curator imported.
 *
 * `analysisJson` is stored verbatim from the curator's `analysis` object, so in
 * practice it carries the detailed-analysis shape — but the reference contract
 * types it as `Record<string, unknown>`, and a hand-edited or older record can
 * be missing dimensions. So every dimension is read defensively and absence is
 * reported as absence. Nothing here fills a gap in.
 */
export const ANALYSIS_DIMENSIONS = [
  "typography",
  "palette",
  "layout",
  "texture",
  "imagery",
  "uiPatterns",
  "motion",
  "avoid",
] as const;

export type AnalysisDimension = (typeof ANALYSIS_DIMENSIONS)[number];

export function readAnalysisDimension(
  reference: Pick<ReferenceResponse, "analysisJson">,
  dimension: AnalysisDimension,
): readonly string[] {
  const json = reference.analysisJson;
  if (json === null) {
    return [];
  }
  const value = json[dimension];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}
