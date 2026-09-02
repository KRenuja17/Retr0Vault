import type { ReferenceTagInput, ReferenceTagResponse } from "@retr0vault/shared";

/**
 * Vocabulary is edited as one `type: value` per line — the same shape the
 * analysis schema stores, written plainly enough to paste in or out.
 */
export function formatVocabulary(
  tags: readonly ReferenceTagResponse[],
): string {
  return tags.map((tag) => `${tag.type}: ${tag.value}`).join("\n");
}

export interface VocabularyParse {
  readonly tags: readonly ReferenceTagInput[];
  readonly error: string | null;
}

export function parseVocabulary(text: string): VocabularyParse {
  const tags: ReferenceTagInput[] = [];
  const seen = new Set<string>();

  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const separator = trimmed.indexOf(":");
    if (separator < 1) {
      return {
        tags: [],
        error: `Line ${index + 1} needs the form "type: term", for example "palette: bone white with ember accent".`,
      };
    }

    const type = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (type === "" || value === "") {
      return {
        tags: [],
        error: `Line ${index + 1} is missing a ${type === "" ? "type" : "term"}.`,
      };
    }
    if (type.length > 50 || value.length > 300) {
      return {
        tags: [],
        error: `Line ${index + 1} is too long: a type holds 50 characters and a term 300.`,
      };
    }

    // The backend rejects a repeated type/term pair for one reference; saying
    // so here names the line rather than returning a bare validation error.
    const key = `${type.toLocaleLowerCase("en-US")}\u0000${value
      .toLocaleLowerCase("en-US")
      .replace(/\s+/gu, " ")}`;
    if (seen.has(key)) {
      return { tags: [], error: `Line ${index + 1} repeats an earlier term.` };
    }
    seen.add(key);

    tags.push({ type, value });
  }

  if (tags.length > 200) {
    return { tags: [], error: "A reference holds at most 200 vocabulary terms." };
  }

  return { tags, error: null };
}
