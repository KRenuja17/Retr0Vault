/*
 * Which references a multi-reference action is about.
 *
 * The catalogue holds the working selection in memory, but /compare and
 * /direction carry it in the address instead: there the ids are the page's
 * subject, so the sheet has to survive a refresh and be linkable. Everything
 * here is pure, so the encoding can be asserted without a router.
 */

/** The backend accepts at most 100 ids in one export selection. */
export const MAX_SELECTION = 100;

/**
 * `pending-combination` needs two sources before there is anything to
 * reconcile, and a comparison of one reference is not a comparison.
 */
export const MIN_MULTI_SELECTION = 2;

/** The search parameter carrying the selection on /compare and /direction. */
export const REFS_PARAM = "refs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Reads a selection out of a `refs` parameter. The address is untrusted — a
 * hand-edited link can put anything there — so anything that is not a UUID is
 * dropped rather than sent to the backend. Order is preserved and duplicates
 * collapse to their first appearance, because position decides which reference
 * is primary.
 */
export function parseRefs(raw: string | null | undefined): readonly string[] {
  if (raw === null || raw === undefined) {
    return [];
  }
  const ids = new Set<string>();
  for (const part of raw.split(",")) {
    if (ids.size >= MAX_SELECTION) {
      break;
    }
    const id = part.trim().toLowerCase();
    if (UUID.test(id)) {
      ids.add(id);
    }
  }
  return [...ids];
}

export function serialiseRefs(ids: readonly string[]): string {
  return ids.join(",");
}

function pathWithRefs(path: string, ids: readonly string[]): string {
  return `${path}?${REFS_PARAM}=${encodeURIComponent(serialiseRefs(ids))}`;
}

/** `/compare?refs=…` for the current selection, in selection order. */
export function comparePath(ids: readonly string[]): string {
  return pathWithRefs("/compare", ids);
}

/** `/direction?refs=…` for the current selection, in selection order. */
export function directionPath(ids: readonly string[]): string {
  return pathWithRefs("/direction", ids);
}

/**
 * Marks or unmarks one plate. A plate joins the selection at the end and
 * leaves it in place, so the first-marked reference stays primary however many
 * are added or removed after it.
 */
export function toggleId(
  ids: readonly string[],
  id: string,
): readonly string[] {
  if (ids.includes(id)) {
    return ids.filter((candidate) => candidate !== id);
  }
  return ids.length >= MAX_SELECTION ? ids : [...ids, id];
}
