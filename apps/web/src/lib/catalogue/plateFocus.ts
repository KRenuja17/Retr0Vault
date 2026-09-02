/*
 * Focus hand-off between the reference sheet and the plate that opened it.
 *
 * Radix restores focus to whatever was focused when the dialog mounted, which
 * works for a dialog opened by a button that stays on screen. Here the sheet is
 * a route: opening it unmounts the catalogue, so by the time the sheet closes
 * Radix's saved element is detached and focus falls to the body.
 *
 * So the sheet records which plate to return to, and the plate claims that
 * focus when it next mounts. A one-shot module-level slot is the right scope —
 * it survives the unmount that context or state would not, and the plate can
 * claim it whenever its data happens to arrive.
 */

let pendingReferenceId: string | undefined;

/** Called as the sheet closes, naming the plate that should regain focus. */
export function requestPlateFocus(referenceId: string): void {
  pendingReferenceId = referenceId;
}

/** Called by a plate as it mounts; true exactly once, for the named plate. */
export function consumePlateFocus(referenceId: string): boolean {
  if (pendingReferenceId !== referenceId) {
    return false;
  }
  pendingReferenceId = undefined;
  return true;
}

/** Drops any pending request; used between tests. */
export function clearPlateFocus(): void {
  pendingReferenceId = undefined;
}
