import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { ApiError, SIGNED_OUT_EVENT } from "@/lib/api/client";
import { fetchSession } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";

/** A session read longer ago than this is read again before it is trusted on a return. */
export const SESSION_RECHECK_MS = 60_000;

/** What outlives a session: the session itself, and what anyone may read. */
const PUBLIC_QUERIES = new Set(["session", "showcase", "health"]);

/**
 * The signed-in account: `data.user` when signed in, `data === null` when
 * not. Read once and kept; signing in or out writes it directly. Coming back
 * to the window after a while reads it again, so a session that lapsed or was
 * ended elsewhere is noticed without waiting for the next request.
 */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: Infinity,
    // One more try for a hiccup; none for an API that is not there at all.
    retry: (failures, error) => failures < 1 && !(error instanceof ApiError && error.isOffline),
    // Every guarded room reads the session. A failed read is not retried each
    // time one of them mounts: that would unmount and remount them in a loop.
    retryOnMount: false,
    refetchOnWindowFocus: (query) => (Date.now() - query.state.dataUpdatedAt > SESSION_RECHECK_MS ? "always" : false),
  });
}

/** Drops everything read under an account, so none of it is shown to the next one. */
export function forgetAccountQueries(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => !PUBLIC_QUERIES.has(String(query.queryKey[0])) });
}

/**
 * When the API reports a lost session mid-use (expired, or ended elsewhere),
 * the account is forgotten, so the guarded routes return to the strong room.
 * What was read under it is dropped there, once the page behind is gone.
 */
export function useSignedOutWatcher(): void {
  const client = useQueryClient();
  useEffect(() => {
    const onSignedOut = () => {
      if (client.getQueryData(queryKeys.session()) === null) return;
      client.setQueryData(queryKeys.session(), null);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [client]);
}
