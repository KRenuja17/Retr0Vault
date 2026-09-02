import { useQuery } from "@tanstack/react-query";

import { MonoLabel } from "@/components/primitives";
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

  const state = health.isPending
    ? "checking"
    : health.isSuccess
      ? "online"
      : "offline";

  const text =
    state === "checking"
      ? "Checking API"
      : state === "online"
        ? "API 4611 online"
        : "API 4611 offline";

  return (
    <MonoLabel
      size="small"
      tone={state === "offline" ? "soft" : "muted"}
      uppercase
      className={cx(
        styles.status,
        state === "online" && styles.statusOnline,
        state === "offline" && styles.statusOffline,
      )}
      role="status"
    >
      <span className={styles.statusDot} aria-hidden="true" />
      {text}
    </MonoLabel>
  );
}
