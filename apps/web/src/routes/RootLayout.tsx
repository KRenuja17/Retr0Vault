import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { LoginScene, endedLoginView } from "@/components/vault/LoginScene";
import { VaultLanding } from "@/components/vault/VaultLanding";
import { DoorsProvider, useDoors } from "@/components/vault/VaultDoors";
import { ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { SESSION_RECHECK_MS, useSession, useSignedOutWatcher } from "@/lib/auth/session";
import { FrontDoorContext, useFrontDoor, VaultSleepContext, type FrontDoorState } from "@/lib/vault/frontDoor";

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
 *
 * From any page the front door can be closed again (`useVaultSleep`): its
 * doors close over the page, which stays where it was, still signed in. The
 * session is read again before the doors next open, so a lapsed one opens
 * onto the strong room instead.
 */

export { useFrontDoor } from "@/lib/vault/frontDoor";
export type { FrontDoorState } from "@/lib/vault/frontDoor";

/** The API cannot be reached at all: the session is unknown, not refused. */
function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.isOffline;
}

type LocationState = Record<string, unknown> | null;

function stateOf(state: unknown): Record<string, unknown> {
  return state !== null && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
}

export function RootLayout() {
  useSignedOutWatcher();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const client = useQueryClient();
  const session = useSession();
  const [dismissed, setDismissed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [arrival, setArrival] = useState<"intro" | "closing">("intro");

  // A new visit to the front door raises it again.
  useEffect(() => {
    if (location.pathname === "/" && navigationType === "PUSH") {
      setDismissed(false);
      setArrival("intro");
    }
  }, [location.key, location.pathname, navigationType]);

  const sealed = !dismissed && (location.pathname === "/" || (location.state as { vault?: unknown } | null)?.vault === true);
  const here = `${location.pathname}${location.search}${location.hash}`;

  // Where the page behind the door is now. The door opens after the session is
  // read, and a lapsed session changes the page before React renders again, so
  // opening reads this rather than the location it was created with.
  const behind = useRef({ pathname: location.pathname, search: location.search, hash: location.hash, state: location.state as unknown });
  behind.current = { pathname: location.pathname, search: location.search, hash: location.hash, state: location.state };

  const openVault = useCallback(() => {
    setDismissed(true);
    setOpening(false);
    setArrival("intro");
    const page = behind.current;
    // At `/` the front door's own route chooses the room once the door is gone.
    if (page.pathname === "/") return;
    // Only the front door's own mark is taken off the page; what the page keeps (its sheets) stays.
    const { vault: _vault, ...rest } = stateOf(page.state);
    void navigate(`${page.pathname}${page.search}${page.hash}`, {
      replace: true,
      state: (Object.keys(rest).length > 0 ? rest : null) as LocationState,
    });
  }, [navigate]);

  const sleep = useCallback(() => {
    if (sealed) return;
    setArrival("closing");
    setDismissed(false);
    setOpening(false);
    void navigate(here, { replace: true, state: { ...stateOf(location.state), vault: true } });
  }, [here, location.state, navigate, sealed]);

  /** Before the doors open: a session not read lately is read again, so the right room is behind them. */
  const checkSession = useCallback(async () => {
    const state = client.getQueryState(queryKeys.session());
    if (state?.status === "success" && Date.now() - state.dataUpdatedAt < SESSION_RECHECK_MS) return;
    // A read already under way (the first, on arrival) is waited for, not restarted.
    await client.refetchQueries({ queryKey: queryKeys.session(), exact: true }, { cancelRefetch: false });
    // The session lapsed while the door was shut: the strong room is put behind
    // it now, so the door opens onto it, and signing in returns to the room.
    const page = behind.current;
    if (client.getQueryData(queryKeys.session()) === null && page.pathname !== "/" && page.pathname !== "/login") {
      const next = { from: `${page.pathname}${page.search}`, vault: true };
      behind.current = { pathname: "/login", search: "", hash: "", state: next };
      void navigate("/login", { replace: true, state: next });
    }
  }, [client, navigate]);

  const frontDoor: FrontDoorState = sealed ? (opening ? "opening" : "sealed") : "gone";

  return (
    <DoorsProvider>
      <FrontDoorContext.Provider value={frontDoor}>
        <VaultSleepContext.Provider value={sleep}>
          {sealed ? (
            <VaultLanding
              arrival={arrival}
              depositor={session.data?.user.username}
              onUnlock={checkSession}
              onOpening={() => setOpening(true)}
              onDone={openVault}
            />
          ) : null}
          <div className={styles.page} inert={sealed && !opening}>
            <Outlet />
          </div>
        </VaultSleepContext.Provider>
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

/**
 * The session ended while the depositor was inside (it lapsed, or was ended
 * elsewhere): the vault locks itself. Doors bearing the strong room close over
 * the page, and the strong room is put behind them.
 */
function VaultLocksItself({ from }: { readonly from: string }) {
  const doors = useDoors();
  const navigate = useNavigate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      await doors.close(<LoginScene view={endedLoginView} />);
      void navigate("/login", { replace: true, state: { arrived: "doors", ended: true, from } });
      await new Promise((resolve) => setTimeout(resolve, 120));
      doors.dismiss();
    })();
  }, [doors, from, navigate]);

  return null;
}

/** The vault's rooms need a session; without one the reader is sent to the strong room. */
export function RequireSession({ children }: { readonly children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  const frontDoor = useFrontDoor();
  const wasInside = useRef(false);
  if (session.data?.user !== undefined) wasInside.current = true;

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
    const from = `${location.pathname}${location.search}`;
    // In plain view, the doors close on the room as it was; behind the front door, the room is simply swapped.
    if (wasInside.current && frontDoor === "gone") {
      return (
        <>
          <VaultLocksItself from={from} />
          {children}
        </>
      );
    }
    const vault = (location.state as { vault?: unknown } | null)?.vault === true;
    return <Navigate to="/login" replace state={{ from, ...(vault ? { vault: true } : {}) }} />;
  }
  return <>{children}</>;
}
