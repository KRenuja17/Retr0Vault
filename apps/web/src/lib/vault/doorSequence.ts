/*
 * The vault's doors never part the same way twice in a row. The first door of
 * a visit (the front door) splits left and right; the next (the strong room,
 * on signing in) splits up and down; the next (locking the vault) left and
 * right again; and so on for the rest of the browser session.
 *
 * Only a door that actually moves takes its turn: call `nextDoorSplit` when the
 * doors start, never while rendering.
 */

export type DoorSplit = "left-right" | "up-down";

const KEY = "retr0vault:door-turn";
let memory = 0;

function read(): number {
  try {
    const stored = Number(window.sessionStorage.getItem(KEY));
    return Number.isInteger(stored) && stored >= 0 ? stored : memory;
  } catch {
    return memory;
  }
}

function write(turn: number): void {
  memory = turn;
  try {
    window.sessionStorage.setItem(KEY, String(turn));
  } catch {
    // Storage unavailable: the sequence lives as long as the page does.
  }
}

/** The split the next door will make, without taking the turn. */
export function peekDoorSplit(): DoorSplit {
  return read() % 2 === 0 ? "left-right" : "up-down";
}

/** Takes the next door's turn and returns how it splits. */
export function nextDoorSplit(): DoorSplit {
  const turn = read();
  write(turn + 1);
  return turn % 2 === 0 ? "left-right" : "up-down";
}

/** Tests only: start a fresh visit. */
export function resetDoorSequence(): void {
  write(0);
}
