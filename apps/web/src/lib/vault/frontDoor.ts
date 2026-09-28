import { createContext, useContext } from "react";

/*
 * The front door's standing, shared with every page behind it, and the one
 * way to shut it again from inside: `sleep`, which closes the front door over
 * the page without ending the session. Pressing Enter wakes the vault; if the
 * session lapsed while it slept, the door opens onto the strong room instead.
 */

export type FrontDoorState = "sealed" | "opening" | "gone";

export const FrontDoorContext = createContext<FrontDoorState>("gone");

/** Whether the front door still stands over the page, is opening, or has gone. */
export function useFrontDoor(): FrontDoorState {
  return useContext(FrontDoorContext);
}

export const VaultSleepContext = createContext<() => void>(() => undefined);

/** Closes the front door over the current page: the vault sleeps, the depositor stays signed in. */
export function useVaultSleep(): () => void {
  return useContext(VaultSleepContext);
}
