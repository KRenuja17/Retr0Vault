import { useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ReactiveGridBackground } from "@/components/environment/ReactiveGridBackground";
import { ActionButton, ActionLink, MonoLabel, PageRule } from "@/components/primitives";
import { LoginScene, lockedLoginView } from "@/components/vault/LoginScene";
import { SleepDial } from "@/components/vault/SleepDial";
import { useDoors } from "@/components/vault/VaultDoors";
import { signOut } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";
import { forgetAccountQueries, useSession } from "@/lib/auth/session";
import { SelectionProvider } from "@/lib/selection/SelectionProvider";

import { ConnectionStatus } from "./ConnectionStatus";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  /** Slot for the catalogue filter rail, wired up in the next phase. */
  readonly navigation?: ReactNode;
  readonly children?: ReactNode;
}

/**
 * The page frame every route sits inside: masthead, a heavy rule, the
 * navigation slot, the content well, and mono marginalia at the foot.
 *
 * The reactive grid mounts here rather than per route, so the environment
 * layer survives navigation and is never rebuilt mid-session.
 */
/**
 * Locking the vault: doors bearing the strong room close over the catalogue,
 * the session ends, and the strong room is put behind the closed doors before
 * they are taken away, so the depositor is left standing at its door.
 */
function useLockVault() {
  const doors = useDoors();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [locking, setLocking] = useState(false);

  async function lock() {
    if (locking) return;
    setLocking(true);
    await doors.close(<LoginScene view={lockedLoginView} />);
    await signOut().catch(() => undefined);
    // One update: the session is forgotten as the strong room takes the page.
    client.setQueryData(queryKeys.session(), null);
    void navigate("/login", { replace: true, state: { arrived: "doors" } });
    forgetAccountQueries(client);
    await new Promise((resolve) => setTimeout(resolve, 120));
    doors.dismiss();
  }

  return { lock, locking };
}

export function AppShell({ navigation, children }: AppShellProps) {
  const session = useSession();
  const { lock, locking } = useLockVault();

  return (
    <SelectionProvider>
      <ReactiveGridBackground />

      <div className={styles.shell}>
        <a className="rv-skip-link" href="#catalogue">
          Skip to catalogue
        </a>

        <header className={styles.masthead}>
          <div className={styles.container}>
            <div className={styles.mastheadInner}>
              {/*
                * The accent `0` is the front door's dial, small, and turning it
                * puts the vault to sleep, so it sits between the two halves of
                * the link rather than inside it. The first half carries the
                * whole name for assistive technology; the second is the same
                * link again, for the pointer only.
                */}
              <span className={styles.wordmark}>
                <span className={styles.wordmarkText}>
                  <Link to="/all" className={styles.wordmarkLink} aria-label="Retr0Vault">Retr</Link>
                  <SleepDial variant="mark" />
                  <Link to="/all" className={styles.wordmarkLink} tabIndex={-1} aria-hidden="true">Vault</Link>
                </span>
                <MonoLabel
                  size="small"
                  tone="muted"
                  uppercase
                  className={styles.strapline}
                >
                  Visual archive
                </MonoLabel>
              </span>

              <div className={styles.mastheadMeta}>
                <MonoLabel size="small" tone="muted" uppercase>
                  {session.data?.user === undefined ? "Vault" : `Depositor · ${session.data.user.username}`}
                </MonoLabel>
                <ConnectionStatus />
                <ActionLink variant="outline" size="small" to="/motion">
                  Motion
                </ActionLink>
                <ActionLink variant="outline" size="small" to="/add">
                  Add reference
                </ActionLink>
                <ActionButton
                  variant="quiet"
                  size="small"
                  onClick={() => void lock()}
                  disabled={locking}
                  title="Sign out: the vault's doors close behind you"
                >
                  {locking ? "Locking" : "Lock the vault"}
                </ActionButton>
              </div>
            </div>
          </div>
        </header>

        <div className={styles.container}>
          <PageRule weight="heavy" />
        </div>

        {navigation ? (
          <div className={styles.container}>
            <div className={styles.navSlot}>{navigation}</div>
          </div>
        ) : null}

        <main id="catalogue" className={styles.main}>
          <div className={styles.container}>{children ?? <Outlet />}</div>
        </main>

        <div className={styles.container}>
          <PageRule weight="hairline" />
        </div>

        <footer className={styles.footer}>
          <div className={styles.container}>
            <div className={styles.footerInner}>
              <MonoLabel size="micro" tone="muted" uppercase>
                Retr0Vault V1 · web 4610 · api 4611
              </MonoLabel>
              <span className={styles.footerEnd}>
                <MonoLabel size="micro" tone="muted" uppercase>
                  No cloud · no AI keys
                </MonoLabel>
                <SleepDial variant="link" label="Front door" className={styles.frontDoor} />
              </span>
            </div>
          </div>
        </footer>
      </div>
    </SelectionProvider>
  );
}
