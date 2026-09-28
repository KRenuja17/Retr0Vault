import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, SIGNED_OUT_EVENT } from "@/lib/api/client";
import { fetchSession } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";

/**
 * The signed-in account: `data.user` when signed in, `data === null` when
 * not. Read once and kept; signing in or out writes it directly.
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
  });
}

/**
 * When the API reports a lost session mid-use (expired, or ended elsewhere),
 * the account is forgotten and everything read under it is dropped, so the
 * guarded routes return to the strong room's door.
 */
export function useSignedOutWatcher(): void {
  const client = useQueryClient();
  useEffect(() => {
    const onSignedOut = () => {
      if (client.getQueryData(queryKeys.session()) === null) return;
      client.setQueryData(queryKeys.session(), null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" && query.queryKey[0] !== "showcase" });
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [client]);
}
