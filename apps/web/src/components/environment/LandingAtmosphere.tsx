import { useEffect, useRef, type RefObject } from "react";

import { attachLandingField, type LandingFieldController } from "./landingField";
import styles from "./LandingAtmosphere.module.css";

/** The two canvases are pictures on the doors, hidden from assistive technology. */
export function LandingFieldCanvas() {
  return <canvas className={styles.canvas} data-landing-field="" aria-hidden="true" role="presentation" style={{ pointerEvents: "none" }} />;
}

/** One controller for the paired door pictures, parked throughout the door ceremony. */
export function LandingAtmosphere({ root, running, reduced }: {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly running: boolean;
  readonly reduced: boolean;
}) {
  const controller = useRef<LandingFieldController | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (root.current === null) return;
    const field = attachLandingField(root.current, reduced, runningRef.current);
    controller.current = field;
    return () => { field.dispose(); controller.current = null; };
  }, [reduced, root]);
  useEffect(() => { controller.current?.setRunning(running); }, [running]);
  return null;
}
