import { useCallback, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { ReactiveGridBackground } from "@/components/environment/ReactiveGridBackground";
import { ActionLink, MonoLabel, PageRule } from "@/components/primitives";
import { SelectionProvider } from "@/lib/selection/SelectionProvider";
import { VaultLanding } from "@/components/vault/VaultLanding";

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
export function AppShell({ navigation, children }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  /*
   * The front door: arriving at `/` lands on the catalogue with the vault shut
   * over it. The catalogue renders underneath all along, so opening the doors
   * reveals the real plates; until then it is inert.
   */
  const sealed = (location.state as { vault?: unknown } | null)?.vault === true;
  const openVault = useCallback(() => {
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, navigate]);

  return (
    <SelectionProvider>
      <ReactiveGridBackground />

      {sealed ? <VaultLanding onDone={openVault} /> : null}

      <div className={styles.shell} inert={sealed}>
        <a className="rv-skip-link" href="#catalogue">
          Skip to catalogue
        </a>

        <header className={styles.masthead}>
          <div className={styles.container}>
            <div className={styles.mastheadInner}>
              <Link to="/all" className={styles.wordmark}>
                {/*
                  * The accent `0` is a separate element, which otherwise makes
                  * the accessible name read "Retr 0 Vault". aria-label restores
                  * it.
                  */}
                <span className={styles.wordmarkText} aria-label="Retr0Vault">
                  Retr<span className={styles.wordmarkMark}>0</span>Vault
                </span>
                <MonoLabel
                  size="small"
                  tone="muted"
                  uppercase
                  className={styles.strapline}
                >
                  Visual archive
                </MonoLabel>
              </Link>

              <div className={styles.mastheadMeta}>
                <MonoLabel size="small" tone="muted" uppercase>
                  Local · single user
                </MonoLabel>
                <ConnectionStatus />
                <ActionLink variant="outline" size="small" to="/motion">
                  Motion
                </ActionLink>
                <ActionLink variant="outline" size="small" to="/add">
                  Add reference
                </ActionLink>
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
                <Link to="/" className={styles.frontDoor}>
                  <MonoLabel size="micro" tone="muted" uppercase>
                    Front door
                  </MonoLabel>
                </Link>
              </span>
            </div>
          </div>
        </footer>
      </div>
    </SelectionProvider>
  );
}
