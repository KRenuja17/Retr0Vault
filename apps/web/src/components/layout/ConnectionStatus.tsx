import { useQuery } from "@tanstack/react-query";

import { MonoLabel } from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { fetchHealth } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";
import { cx } from "@/lib/cx";

import styles from "./AppShell.module.css";

/**
 * Marginalia in the masthead: whether the local API on 4611 is answering.
 * Deliberately a text state rather than an icon or a toast.
 */
export function ConnectionStatus() {
  const health = useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  /*
   * "Offline" means nothing is listening. An API that answers with an error is
   * reachable, and saying otherwise would send the reader to the wrong place.
   */
  const state = health.isPending
    ? "checking"
    : health.isSuccess
      ? "online"
      : health.error instanceof ApiError && !health.error.isOffline
        ? "faulty"
        : "offline";

  const text = {
    checking: "Checking API",
    online: "API 4611 online",
    faulty: "API 4611 erroring",
    offline: "API 4611 offline",
  }[state];

  return (
    <MonoLabel
      size="small"
      tone={state === "online" || state === "checking" ? "muted" : "soft"}
      uppercase
      className={cx(
        styles.status,
        state === "online" && styles.statusOnline,
        (state === "offline" || state === "faulty") && styles.statusOffline,
      )}
      role="status"
    >
      <span className={styles.statusDot} aria-hidden="true" />
      {text}
    </MonoLabel>
  );
}
