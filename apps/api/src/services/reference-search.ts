import { sql } from "drizzle-orm";

// Treat user input as literal words, never as FTS operators or SQL. Every word
// is required, but words may match different fields of the same reference.
export function referenceSearchExpression(query: string): string | undefined {
  const words = query.normalize("NFKC").match(/[\p{L}\p{N}\p{M}\p{Co}]+/gu) ?? [];
  if (words.length === 0) return undefined;
  return [...new Set(words.map((word) => word.toLowerCase()))]
    .map((word) => `"${word}"`)
    .join(" AND ");
}

// Column order is defined by 0004_reference_search.sql. Concise visual
// descriptors receive more weight than long-form briefs and source URLs.
export const referenceSearchRank = sql`bm25(reference_search, 0, 12, 8, 4, 6, 3, 5, 1, 1, 1, 1)`;
