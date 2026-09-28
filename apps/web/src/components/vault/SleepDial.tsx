import { useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@/lib/cx";
import { useReducedMotion } from "@/lib/motion/preferences";
import { useVaultSleep } from "@/lib/vault/frontDoor";

import styles from "./SleepDial.module.css";

/*
 * The way back to the front door: the front door's dial, small. Pressed, it
 * spins back to zero, and the front door's two halves close over the page.
 * The vault sleeps; the session is kept, and Enter wakes it.
 *
 * As the `mark` it stands in for the accent 0 of the masthead's wordmark, as
 * the dial does on the front door itself; as a `link` it leads a label.
 */

/** The dial's turn back to zero, before the doors start to close. */
const SPIN_MS = 560;

export interface SleepDialProps {
  readonly variant: "mark" | "link";
  /** Shown after the dial (the `link` variant). */
  readonly label?: ReactNode;
  /** A picture only (on a door): not pressable. */
  readonly still?: boolean;
  readonly className?: string | undefined;
}

function Face() {
  return (
    <svg className={styles.svg} viewBox="0 0 200 200" focusable="false" aria-hidden="true">
      <g className={styles.face}>
        <circle className={styles.ring} cx="100" cy="100" r="62" />
        <rect className={styles.notch} x="95" y="27" width="10" height="24" />
      </g>
      <path className={styles.index} d="M84 0 H116 L100 20 Z" />
    </svg>
  );
}

export function SleepDial({ variant, label, still = false, className }: SleepDialProps) {
  const sleep = useVaultSleep();
  const reduced = useReducedMotion();
  const [turning, setTurning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const classes = cx(styles.sleep, styles[variant], turning && styles.turning, className);

  if (still) {
    return (
      <span className={classes} aria-hidden="true">
        <span className={styles.dial}><Face /></span>
        {label === undefined ? null : <span className={styles.label}>{label}</span>}
      </span>
    );
  }

  const onClick = () => {
    if (turning) return;
    if (reduced) {
      sleep();
      return;
    }
    setTurning(true);
    timer.current = setTimeout(() => {
      setTurning(false);
      sleep();
    }, SPIN_MS);
  };

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      disabled={turning}
      aria-label={variant === "mark" ? "Sleep: back to the front door, still signed in" : undefined}
      title="Back to the front door. The vault sleeps; you stay signed in."
    >
      <span className={styles.dial}><Face /></span>
      {variant === "mark" ? <span className={styles.caption} aria-hidden="true">Sleep</span> : null}
      {label === undefined ? null : <span className={styles.label}>{label}</span>}
    </button>
  );
}
