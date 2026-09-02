import type { DesignTypeResponse } from "@retr0vault/shared";

/**
 * Text prepared for pasting into a coding agent. Both payloads are built only
 * from stored design-type data — nothing here invents guidance the archive
 * does not hold.
 */

/** The vocabulary alone, one term per line, with no labels or punctuation. */
export function vocabularyCopyText(designType: DesignTypeResponse): string {
  return designType.vocabulary.map((term) => term.trim()).join("\n");
}

/**
 * The stored brief block, passed through verbatim apart from trimming. The
 * backend owns this text; reformatting it would change guidance the curator
 * wrote deliberately.
 */
export function briefCopyText(designType: DesignTypeResponse): string {
  return designType.briefBlock.trim();
}
