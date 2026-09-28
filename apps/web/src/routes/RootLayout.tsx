import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";

import { VaultLanding } from "@/components/vault/VaultLanding";
import { DoorsProvider } from "@/components/vault/VaultDoors";
import { ApiError } from "@/lib/api/client";
import { useSession, useSignedOutWatcher } from "@/lib/auth/session";

import styles from "./RootLayout.module.css";

/*
 * Above every page: the front door, the vault's doors, and the watch on the
 * session.
 *
 * The front door (the landing) stands over whatever page is behind it: the
 * strong room for a visitor who has not signed in, the catalogue for one who
 * has. It is up while the address is `/`, or while a page was reached with
 * `state.vault`, until it is opened or skipped (and again on a new visit to
 * `/`); the page behind stays inert until it opens.
 */

/** The API cannot be reached at all: the session is unknown, not refused. */
function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.isOffline;
}

export type FrontDoorState = "sealed" | "opening" | "gone";

const FrontDoorContext = createContext<FrontDoorState>("gone");

/** Whether the front door still stands over the page, is opening, or has gone. */
export function useFrontDoor(): FrontDoorState {
  return useContext(FrontDoorContext);
}

export function RootLayout() {
  useSignedOutWatcher();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [dismissed, setDismissed] = useState(false);
  const [opening, setOpening] = useState(false);

  // A new visit to the front door raises it again.
  useEffect(() => {
    if (location.pathname === "/" && navigationType === "PUSH") setDismissed(false);
  }, [location.key, location.pathname, navigationType]);

  const sealed = !dismissed && (location.pathname === "/" || (location.state as { vault?: unknown } | null)?.vault === true);

  const openVault = useCallback(() => {
    setDismissed(true);
    setOpening(false);
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, navigate]);

  const frontDoor: FrontDoorState = sealed ? (opening ? "opening" : "sealed") : "gone";

  return (
    <DoorsProvider>
      <FrontDoorContext.Provider value={frontDoor}>
        {sealed ? <VaultLanding onOpening={() => setOpening(true)} onDone={openVault} /> : null}
        <div className={styles.page} inert={sealed && !opening}>
          <Outlet />
        </div>
      </FrontDoorContext.Provider>
    </DoorsProvider>
  );
}

/**
 * `/` — the front door. It stays up while the session is read, then the page
 * behind it is chosen: the catalogue for a depositor, the strong room otherwise.
 */
export function FrontDoorRoute() {
  const session = useSession();
  const frontDoor = useFrontDoor();
  if (session.isPending) return null;
  // With the API unreachable the catalogue explains why it is empty.
  const inside = session.data?.user !== undefined || isUnreachable(session.error);
  return <Navigate to={inside ? "/all" : "/login"} replace state={frontDoor === "gone" ? null : { vault: true }} />;
}

/** The vault's rooms need a session; without one the reader is sent to the strong room. */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return <p className={styles.pending}>Reading the vault’s register…</p>;
  }
  // The API cannot be reached at all: the rooms render and say so; every
  // request they make is still guarded, and a refusal brings the strong room.
  if (session.isError && isUnreachable(session.error)) return <>{children}</>;
  if (session.isError) {
    return (
      <p className={styles.pending} role="alert">
        The vault is not answering. Start it with npm run dev, then reload this page.
      </p>
    );
  }
  if (session.data === null) {
    const vault = (location.state as { vault?: unknown } | null)?.vault === true;
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}`, ...(vault ? { vault: true } : {}) }}
      />
    );
  }
  return <>{children}</>;
}
