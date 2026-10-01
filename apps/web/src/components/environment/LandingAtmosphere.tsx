import { useEffect, useRef, useState, type RefObject } from "react";

import { LANDING_EFFECTS, attachLandingField, type LandingEffect, type LandingFieldController } from "./landingField";
import styles from "./LandingAtmosphere.module.css";

const PREVIEW_KEY = "retr0vault.landing.field-preview";
const DEFAULT_EFFECT: LandingEffect = "engraving";

function readPreview(): LandingEffect {
  if (import.meta.env.DEV) {
    try {
      const saved = window.sessionStorage.getItem(PREVIEW_KEY);
      if (LANDING_EFFECTS.some((effect) => effect.id === saved)) return saved as LandingEffect;
    } catch { /* The comparison still works when browser storage is blocked. */ }
  }
  return DEFAULT_EFFECT;
}

export function useLandingEffect(): readonly [LandingEffect, (effect: LandingEffect) => void] {
  const [effect, setEffect] = useState(readPreview);
  return [effect, (next) => {
    setEffect(next);
    if (import.meta.env.DEV) {
      try { window.sessionStorage.setItem(PREVIEW_KEY, next); } catch { /* Page-local choice. */ }
    }
  }];
}

/** The two canvases are pictures on the doors, hidden from assistive technology. */
export function LandingFieldCanvas() {
  return <canvas className={styles.canvas} data-landing-field="" aria-hidden="true" role="presentation" style={{ pointerEvents: "none" }} />;
}

/** One controller for the paired door pictures, parked throughout the door ceremony. */
export function LandingAtmosphere({ root, effect, running, reduced }: {
  readonly root: RefObject<HTMLDivElement | null>;
  readonly effect: LandingEffect;
  readonly running: boolean;
  readonly reduced: boolean;
}) {
  const controller = useRef<LandingFieldController | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  useEffect(() => {
    if (root.current === null) return;
    const field = attachLandingField(root.current, effect, reduced, runningRef.current);
    controller.current = field;
    return () => { field.dispose(); controller.current = null; };
  }, [effect, reduced, root]);
  useEffect(() => { controller.current?.setRunning(running); }, [running]);
  return null;
}

/** Temporary development comparison desk; the production build has no controls. */
export function LandingEffectPicker({ effect, onChange }: {
  readonly effect: LandingEffect;
  readonly onChange: (next: LandingEffect) => void;
}) {
  if (!import.meta.env.DEV) return null;
  const index = LANDING_EFFECTS.findIndex((option) => option.id === effect);
  const selected = LANDING_EFFECTS[index]!;
  return (
    <aside className={styles.picker} aria-label="Landing effect studies" onKeyDown={(event) => {
      // Enter/Space activate this desk's buttons, without opening the vault.
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    }}>
      <span className={styles.caption}>Field studies <span className={styles.dev}>Dev</span></span>
      <button type="button" className={styles.next} aria-label={`Next landing effect. Current: ${selected.name}`} onClick={() => {
        onChange(LANDING_EFFECTS[(index + 1) % LANDING_EFFECTS.length]!.id);
      }}>
        <span>{selected.name}</span><span aria-hidden="true">↗</span>
      </button>
      <div className={styles.choices} role="group" aria-label="Choose landing effect">
        {LANDING_EFFECTS.map((option, position) => (
          <button key={option.id} type="button" aria-label={option.name} aria-pressed={effect === option.id} onClick={() => onChange(option.id)}>
            {position === LANDING_EFFECTS.length - 1 ? "Off" : String(position + 1).padStart(2, "0")}
          </button>
        ))}
      </div>
      <p className={styles.detail} aria-live="polite">{selected.detail}</p>
    </aside>
  );
}
