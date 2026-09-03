import { useQueries } from "@tanstack/react-query";
import type { ReferenceResponse } from "@retr0vault/shared";

import { fetchReference } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";

export interface SelectedReference {
  readonly id: string;
  /** Undefined until this reference's own request has resolved. */
  readonly reference: ReferenceResponse | undefined;
  readonly error: unknown;
}

export interface SelectedReferences {
  readonly entries: readonly SelectedReference[];
  /** True while any selected reference is still being read. */
  readonly pending: boolean;
  /** Every reference that resolved, in selection order. */
  readonly resolved: readonly ReferenceResponse[];
  /** The first failure, if any reference could not be read. */
  readonly error: unknown;
}

/**
 * Reads every reference in a selection: one request each, keyed exactly as the
 * reference sheet keys its own, so a plate already opened is served from cache
 * rather than fetched twice.
 *
 * The ids come from the address, so this works on a pasted link or a refresh
 * with no catalogue behind it. Derivation is left unmemoised on purpose — the
 * selection is capped at 100, and memoising on a fresh results array each
 * render buys nothing but a stale-data hazard.
 */
export function useSelectedReferences(
  ids: readonly string[],
): SelectedReferences {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.reference(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchReference(id, signal),
    })),
  });

  const entries: SelectedReference[] = ids.map((id, index) => {
    const result = results[index];
    return {
      id,
      reference: result?.data,
      error: result?.error ?? null,
    };
  });

  return {
    entries,
    pending: results.some((result) => result.isPending),
    resolved: entries
      .map((entry) => entry.reference)
      .filter((reference): reference is ReferenceResponse => reference !== undefined),
    error: entries.find((entry) => entry.error !== null)?.error ?? null,
  };
}
