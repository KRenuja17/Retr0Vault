import type { ReactNode } from "react";
import { Link, Outlet } from "react-router-dom";

import { MonoLabel, PageRule } from "@/components/primitives";

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
 */
export function AppShell({ navigation, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <a className="rv-skip-link" href="#catalogue">
        Skip to catalogue
      </a>

      <header className={styles.masthead}>
        <div className={styles.container}>
          <div className={styles.mastheadInner}>
            <Link to="/all" className={styles.wordmark}>
              {/*
                * The accent `0` is a separate element, which otherwise makes the
                * accessible name read "Retr 0 Vault". aria-label restores it.
                */}
              <span className={styles.wordmarkText} aria-label="Retr0Vault">
                Retr<span className={styles.wordmarkMark}>0</span>Vault
              </span>
              <MonoLabel size="small" tone="muted" uppercase className={styles.strapline}>
                Visual archive
              </MonoLabel>
            </Link>

            <div className={styles.mastheadMeta}>
              <MonoLabel size="small" tone="muted" uppercase>
                Local · single user
              </MonoLabel>
              <ConnectionStatus />
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
            <span className={styles.footerLinks}>
              <Link to="/foundation">
                <MonoLabel size="micro" tone="muted" uppercase>
                  Visual system
                </MonoLabel>
              </Link>
              <MonoLabel size="micro" tone="muted" uppercase>
                No cloud · no AI keys
              </MonoLabel>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
