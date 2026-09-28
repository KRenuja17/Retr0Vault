import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { cx } from "@/lib/cx";
import { useReducedMotion } from "@/lib/motion/preferences";
import { nextDoorSplit, type DoorSplit } from "@/lib/vault/doorSequence";

import styles from "./VaultDoors.module.css";

/*
 * The vault's doors, for every passage after the front door.
 *
 * A picture of the page is printed on two doors that meet at a seam. To open,
 * the doors are shown over the page exactly as it looks, the page behind them
 * is swapped for the next one, a seam is cut, and the doors part. To close,
 * the doors come together over the current page, bearing a picture of the page
 * that is about to appear, which is then put behind them before they vanish.
 *
 * Which way they split follows the visit's sequence (`nextDoorSplit`): left and
 * right, then up and down, then left and right…
 */

type Phase = "shut" | "seamed" | "parting" | "apart" | "closing" | "sealed";

interface Scene {
  readonly face: ReactNode;
  readonly split: DoorSplit;
  readonly phase: Phase;
}

export interface VaultDoorsApi {
  /**
   * Shows `face` as closed doors, runs `behind` (put the next page in place),
   * then opens the doors onto it. Resolves once they are gone.
   */
  open(face: ReactNode, behind: () => void | Promise<void>): Promise<void>;
  /** Closes doors bearing `face` over the page. Resolves once they are shut; `dismiss` removes them. */
  close(face: ReactNode): Promise<void>;
  dismiss(): void;
}

const DoorsContext = createContext<VaultDoorsApi | null>(null);

const SEAM_MS = 380;
const MOVE_MS = 1_150;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Two frames: the next style is painted before a transition starts from it. */
const painted = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame !== "function") {
    resolve();
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});
/**
 * A quiet moment: the page just put behind the doors has finished arriving (its
 * plates rendered, its first pictures decoded), or `limit` has passed. The seam
 * is cut then, so a busy frame cannot swallow it.
 */
const quiet = (limit: number) => new Promise<void>((resolve) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => resolve(), { timeout: limit });
  else setTimeout(resolve, 0);
});
const QUIET_LIMIT_MS = 450;

/**
 * Deal the catalogue plates that are on screen, in reading order, as the doors
 * part: each rises a little and straightens, like an index card set down.
 */
export function dealCatalogue(): void {
  const plates = [...document.querySelectorAll<HTMLElement>("#catalogue article")]
    .filter((plate) => plate.getBoundingClientRect().top < window.innerHeight)
    .slice(0, 12);
  plates.forEach((plate, index) => {
    if (typeof plate.animate !== "function") return;
    const tilt = index % 2 === 0 ? -1.6 : 1.2;
    plate.animate(
      [
        { opacity: 0, transform: `translateY(64px) rotate(${tilt}deg)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 720, delay: 260 + index * 90, easing: "cubic-bezier(0.2, 0, 0.2, 1)", fill: "backwards" },
    );
  });
}

export function DoorsProvider({ children }: { readonly children: ReactNode }) {
  const reduced = useReducedMotion();
  const [scene, setScene] = useState<Scene | null>(null);
  const running = useRef(false);

  const phase = useCallback((next: Phase) => setScene((current) => (current === null ? null : { ...current, phase: next })), []);

  const open = useCallback<VaultDoorsApi["open"]>(async (face, behind) => {
    if (reduced || running.current) {
      await behind();
      return;
    }
    running.current = true;
    try {
      setScene({ face, split: nextDoorSplit(), phase: "shut" });
      await painted();
      await behind();
      await quiet(QUIET_LIMIT_MS);
      await painted();
      phase("seamed");
      // The seam's moment is counted from when it is on screen, not from when it was asked for.
      await painted();
      await wait(SEAM_MS);
      phase("parting");
      dealCatalogue();
      await wait(MOVE_MS + 80);
    } finally {
      setScene(null);
      running.current = false;
    }
  }, [phase, reduced]);

  const close = useCallback<VaultDoorsApi["close"]>(async (face) => {
    if (reduced || running.current) return;
    running.current = true;
    setScene({ face, split: nextDoorSplit(), phase: "apart" });
    await painted();
    phase("closing");
    await wait(MOVE_MS + 40);
    phase("sealed");
    await painted();
    await wait(SEAM_MS);
  }, [phase, reduced]);

  const dismiss = useCallback(() => {
    setScene(null);
    running.current = false;
  }, []);

  const api = useMemo<VaultDoorsApi>(() => ({ open, close, dismiss }), [open, close, dismiss]);

  return (
    <DoorsContext.Provider value={api}>
      {children}
      {scene === null ? null : (
        <div className={cx(styles.doors, scene.split === "left-right" ? styles.leftRight : styles.upDown, styles[scene.phase])} aria-hidden="true">
          <div className={cx(styles.door, styles.first)}>
            <div className={styles.face}>{scene.face}</div>
          </div>
          <div className={cx(styles.door, styles.second)}>
            <div className={styles.face}>{scene.face}</div>
          </div>
          <span className={styles.seam} />
          <span className={styles.spark} />
        </div>
      )}
    </DoorsContext.Provider>
  );
}

export function useDoors(): VaultDoorsApi {
  const api = useContext(DoorsContext);
  if (api === null) throw new Error("useDoors must be used inside DoorsProvider");
  return api;
}
