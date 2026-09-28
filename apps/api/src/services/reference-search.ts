import { sql, type SQL } from "drizzle-orm";

/*
 * Search queries against the tsvector documents built in migration 0002.
 *
 * User input is treated as literal words, never as query operators or SQL:
 * words are extracted, folded exactly as the documents are (NFKD, accents
 * removed, lower case), and every word is required, though words may match
 * different fields of the same record. The folded words are bound as a
 * parameter to plainto_tsquery, which cannot express operators.
 */

export function searchWords(query: string): string | undefined {
  const words = query.normalize("NFKD").replace(/[̀-ͯ]/gu, "").match(/[\p{L}\p{N}\p{M}\p{Co}]+/gu) ?? [];
  if (words.length === 0) return undefined;
  return [...new Set(words.map((word) => word.toLowerCase()))].join(" ");
}

/** A tsquery for the folded words (from `searchWords`). */
export function searchQuery(words: string): SQL {
  return sql`plainto_tsquery('simple', ${words})`;
}

// Weights are {D, C, B, A}: concise descriptors outrank long-form briefs and URLs.
export function referenceSearchRank(words: string): SQL {
  return sql`ts_rank('{0.1, 0.35, 0.65, 1.0}', reference_search.document, ${searchQuery(words)})`;
}

export function motionSearchRank(words: string): SQL {
  return sql`ts_rank('{0.1, 0.3, 0.7, 1.0}', motion_search.document, ${searchQuery(words)})`;
}
