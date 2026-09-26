import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReferenceResponse } from "@retr0vault/shared";

import { ConnectionStatus } from "@/components/layout/ConnectionStatus";
import { fetchReferences } from "@/lib/api/endpoints";
import { referenceThumbnailUrl } from "@/lib/api/media";
import { useStats } from "@/lib/catalogue/useCatalogue";
import { cx } from "@/lib/cx";
import { useReducedMotion } from "@/lib/motion/preferences";

import styles from "./VaultLanding.module.css";

/*
 * The front door of the archive.
 *
 * The page is printed twice, once on each of two doors that meet down the
 * middle of the screen, so the whole composition (the wordmark, the dial in
 * place of its accent 0, the counters and the contact strip) splits cleanly
 * when the doors part. The doors open onto the real catalogue, already rendered
 * underneath, and its plates are dealt in as the gap widens.
 *
 * Everything that can be read or pressed lives once, in a control layer above
 * the doors; the doors themselves are pictures of the page and are hidden from
 * assistive technology.
 */

export interface VaultLandingProps {
  /** The doors are fully open: remove the landing. */
  readonly onDone: () => void;
}

type Phase = "ready" | "unlocking" | "seamed" | "opening";

/** One tick of the dial is one number: 60 numbers round the face. */
const DEGREES_PER_NUMBER = 6;
/** Where the combination falls back to while the archive is still being read. */
const FALLBACK_COMBINATION: readonly [number, number, number] = [4, 17, 9];
/** Counters roll up in steps, like an odometer, after the type has landed. */
const COUNT_DELAY_MS = 1100;
const COUNT_STEPS = 18;
const COUNT_STEP_MS = 45;
/** The doors' transition; the landing is removed on its transitionend, or after this. */
const DOOR_SAFETY_MS = 1700;
const STRIP_MIN_FRAMES = 12;

const WORD_LEFT = "Retr";
const WORD_RIGHT = "Vault";

function pad(value: number, digits = 2): string {
  return String(Math.max(0, Math.round(value))).padStart(digits, "0");
}

/** The number under the fixed index mark for a dial turned by `turn` degrees. */
function numberAt(turn: number): number {
  const normalized = ((-turn % 360) + 360) % 360;
  return Math.round(normalized / DEGREES_PER_NUMBER) % 60;
}

/**
 * The turn that brings `target` under the index, moving in `direction`
 * (1 = clockwise) from `from`, going at least `minimum` degrees.
 */
function turnTo(from: number, target: number, direction: 1 | -1, minimum: number): number {
  const goal = -target * DEGREES_PER_NUMBER;
  let delta = (((goal - from) % 360) + 360) % 360;
  if (direction === -1) delta = delta === 0 ? 0 : delta - 360;
  let turn = from + delta;
  while (Math.abs(turn - from) < minimum) turn += direction * 360;
  return turn;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A cubic ease-out tween; settles, never overshoots. Instant without a frame loop. */
function tween(from: number, to: number, ms: number, apply: (value: number) => void): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      apply(to);
      resolve();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      apply(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/**
 * Deal the catalogue plates that are on screen, in reading order, as the doors
 * part: each rises a little and straightens, like an index card set down.
 */
function dealCatalogue() {
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

function Dial() {
  const ticks = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);
  return (
    <span className={styles.dial}>
      <span className={styles.dialIndex} />
      <svg className={styles.dialSvg} viewBox="0 0 200 200" focusable="false">
        <g className={styles.dialFace}>
          {ticks.map((index) => {
            const major = index % 5 === 0;
            return (
              <line
                key={index}
                className={cx(styles.tick, major && styles.tickMajor)}
                style={{ "--i": index } as CSSProperties}
                x1="100"
                y1={major ? 4 : 8}
                x2="100"
                y2="18"
                transform={`rotate(${index * DEGREES_PER_NUMBER} 100 100)`}
              />
            );
          })}
          {ticks.filter((index) => index % 10 === 0).map((index) => (
            <text
              key={`n${index}`}
              className={styles.dialNumber}
              x="100"
              y="62"
              transform={`rotate(${index * DEGREES_PER_NUMBER} 100 100)`}
            >
              {pad(index)}
            </text>
          ))}
          {/* The accent 0 itself: a heavy ring with one notch, so a turn can be seen. */}
          <circle className={styles.ring} cx="100" cy="100" r="62" pathLength="100" />
          <rect className={styles.notch} x="97" y="25" width="6" height="26" />
        </g>
        <circle className={styles.hub} cx="100" cy="100" r="3" />
      </svg>
    </span>
  );
}

function Word({ text, offset }: { readonly text: string; readonly offset: number }) {
  return (
    <>
      {[...text].map((letter, index) => (
        <span key={index} className={styles.letterClip}>
          <span className={styles.letter} style={{ "--i": offset + index } as CSSProperties}>
            {letter}
          </span>
        </span>
      ))}
    </>
  );
}

interface FaceProps {
  readonly counts: readonly [number, number, number];
  readonly slots: readonly [string, string, string];
  readonly lockedSlots: number;
  readonly frames: readonly ReferenceResponse[];
}

/** The printed page on one door. Pure picture: every door carries the same one. */
function Face({ counts, slots, lockedSlots, frames }: FaceProps) {
  return (
    <div className={styles.face}>
      <span className={cx(styles.registration, styles.registrationTopLeft)} />
      <span className={cx(styles.registration, styles.registrationTopRight)} />
      <span className={cx(styles.registration, styles.registrationBottomLeft)} />
      <span className={cx(styles.registration, styles.registrationBottomRight)} />
      <span className={cx(styles.ruler, styles.rulerLeft)} />
      <span className={cx(styles.ruler, styles.rulerRight)} />

      <div className={styles.bar}>
        <span className={cx(styles.mono, styles.typeIn)} style={{ "--d": "900ms" } as CSSProperties}>
          Retr0Vault — front door
        </span>
        <span className={cx(styles.mono, styles.typeIn, styles.barCentre)} style={{ "--d": "1000ms" } as CSSProperties}>
          Private archive · Vol. 01
        </span>
        <span />
      </div>

      <div className={styles.stage}>
        <span className={cx(styles.mono, styles.overline, styles.typeIn)} style={{ "--d": "950ms" } as CSSProperties}>
          <span className={styles.square} /> Plates · captures · motion studies
        </span>

        <div className={styles.wordmark}>
          <span className={styles.wordLeft}>
            <Word text={WORD_LEFT} offset={0} />
          </span>
          <Dial />
          <span className={styles.wordRight}>
            <Word text={WORD_RIGHT} offset={WORD_LEFT.length} />
          </span>
        </div>

        <div className={styles.rule} />

        <div className={cx(styles.readout, styles.typeIn)} style={{ "--d": "1150ms" } as CSSProperties}>
          <span className={styles.mono}>Combination</span>
          <span className={styles.readoutDigits}>
            {slots.map((slot, index) => (
              <span key={index} className={cx(styles.slot, index < lockedSlots && styles.slotLocked)}>
                {slot}
              </span>
            ))}
          </span>
        </div>

        <p className={cx(styles.tagline, styles.fadeUp)} style={{ "--d": "1250ms" } as CSSProperties}>
          An archive of how things look, and how they move.
        </p>

        <dl className={cx(styles.counters, styles.fadeUp)} style={{ "--d": "1350ms" } as CSSProperties}>
          {(["Plates", "Motion studies", "Design types"] as const).map((label, index) => (
            <div key={label} className={styles.counter}>
              <dt className={styles.mono}>{label}</dt>
              <dd className={styles.counterValue}>{pad(counts[index]!, 4)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div />

      <div className={styles.strip}>
        <div className={styles.stripTrack}>
          {[...frames, ...frames].map((reference, index) => (
            <figure key={`${reference.id}-${index}`} className={styles.frame}>
              <img
                className={styles.frameImage}
                src={referenceThumbnailUrl(reference.id, reference.updatedAt)}
                alt=""
                draggable={false}
              />
              <figcaption className={styles.frameIndex}>
                RV-{pad(((index % frames.length) % 99) + 1)}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div className={styles.bar}>
        <span className={cx(styles.mono, styles.typeIn)} style={{ "--d": "1400ms" } as CSSProperties}>
          No cloud · no AI keys
        </span>
        <span className={cx(styles.mono, styles.typeIn, styles.barCentre)} style={{ "--d": "1500ms" } as CSSProperties}>
          Press ↵ to enter
        </span>
        <span className={cx(styles.mono, styles.typeIn, styles.barEnd)} style={{ "--d": "1600ms" } as CSSProperties}>
          Web 4610 · API 4611
        </span>
      </div>
    </div>
  );
}

export function VaultLanding({ onDone }: VaultLandingProps) {
  const reduced = useReducedMotion();
  const stats = useStats();
  const references = useQuery({
    queryKey: ["references", "vault-strip"],
    queryFn: ({ signal }) => fetchReferences({ page: 1, limit: 16, sort: "newest" }, signal),
  });

  const root = useRef<HTMLDivElement>(null);
  const enter = useRef<HTMLButtonElement>(null);
  const turn = useRef(0);
  const finished = useRef(false);
  const [phase, setPhase] = useState<Phase>("ready");
  const [live, setLive] = useState(0);
  const [locked, setLocked] = useState<number[]>([]);
  const [rolled, setRolled] = useState(0);

  const combination = useMemo<readonly [number, number, number]>(() => {
    if (stats.data === undefined) return FALLBACK_COMBINATION;
    const types = stats.data.countsByDesignType.filter((type) => type.referenceCount > 0).length;
    return [stats.data.totalReferences % 60, stats.data.motionStudies.total % 60, types % 60];
  }, [stats.data]);

  const counts = useMemo<readonly [number, number, number]>(() => {
    if (stats.data === undefined) return [0, 0, 0];
    const types = stats.data.countsByDesignType.filter((type) => type.referenceCount > 0).length;
    const fraction = rolled / COUNT_STEPS;
    return [stats.data.totalReferences * fraction, stats.data.motionStudies.total * fraction, types * fraction];
  }, [stats.data, rolled]);

  const frames = useMemo(() => {
    const items = references.data?.items ?? [];
    if (items.length === 0) return [];
    const filled: ReferenceResponse[] = [];
    while (filled.length < STRIP_MIN_FRAMES) filled.push(...items);
    return filled;
  }, [references.data]);

  const setTurn = useCallback((value: number) => {
    turn.current = value;
    root.current?.style.setProperty("--dial-turn", `${value}deg`);
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  // The page behind the doors does not scroll, and starts at the top.
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    // Focused for the keyboard, without drawing the focus ring on arrival.
    enter.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, []);

  // Counters roll up once the type has landed.
  useEffect(() => {
    if (stats.data === undefined) return undefined;
    if (reduced) {
      setRolled(COUNT_STEPS);
      return undefined;
    }
    let step = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        step += 1;
        setRolled(step);
        if (step >= COUNT_STEPS && interval !== undefined) clearInterval(interval);
      }, COUNT_STEP_MS);
    }, COUNT_DELAY_MS);
    return () => {
      clearTimeout(start);
      if (interval !== undefined) clearInterval(interval);
    };
  }, [stats.data, reduced]);

  // At rest the dial leans toward the pointer, a little, and the readout follows it.
  useEffect(() => {
    if (reduced || phase !== "ready" || typeof requestAnimationFrame !== "function") return undefined;
    let target = turn.current;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const dial = root.current?.querySelector(`.${styles.dial}`);
      if (!dial) return;
      const box = dial.getBoundingClientRect();
      const angle = (Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
      target = (angle + 90) * 0.5;
    };
    const loop = () => {
      const next = turn.current + (target - turn.current) * 0.08;
      if (Math.abs(next - turn.current) > 0.01) {
        setTurn(next);
        setLive(numberAt(next));
      }
      frame = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", onMove);
    frame = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [phase, reduced, setTurn]);

  const open = useCallback(async () => {
    if (phase !== "ready") return;
    if (reduced) {
      finish();
      return;
    }
    setPhase("unlocking");
    const [first, second, third] = combination;
    const stops: Array<[number, 1 | -1, number]> = [[first, 1, 360], [second, -1, 180], [third, 1, 60]];
    for (const [index, [number, direction, minimum]] of stops.entries()) {
      const from = turn.current;
      const to = turnTo(from, number, direction, minimum);
      await tween(from, to, index === 0 ? 900 : 620, (value) => {
        setTurn(value);
        setLive(numberAt(value));
      });
      setLocked((current) => [...current, number]);
      await wait(140);
    }
    setPhase("seamed");
    await wait(380);
    setPhase("opening");
    dealCatalogue();
    setTimeout(finish, DOOR_SAFETY_MS);
  }, [combination, finish, phase, reduced, setTurn]);

  // ↵ opens from anywhere on the page; Escape skips straight in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      else if (event.key === "Enter" && document.activeElement !== enter.current) void open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, open]);

  const slots: [string, string, string] = [
    locked[0] !== undefined ? pad(locked[0]) : pad(live),
    locked[1] !== undefined ? pad(locked[1]) : locked.length === 1 ? pad(live) : "––",
    locked[2] !== undefined ? pad(locked[2]) : locked.length === 2 ? pad(live) : "––",
  ];

  const face = <Face counts={counts} slots={slots} lockedSlots={locked.length} frames={frames} />;
  const summary = stats.data === undefined
    ? "The archive is being read."
    : `${stats.data.totalReferences} plates, ${stats.data.motionStudies.total} motion studies.`;

  return (
    <div
      ref={root}
      className={cx(styles.vault, reduced && styles.still, styles[phase])}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-title"
      aria-describedby="vault-summary"
    >
      <div className={cx(styles.door, styles.doorLeft)} aria-hidden="true" onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "transform") finish();
      }}>
        {face}
      </div>
      <div className={cx(styles.door, styles.doorRight)} aria-hidden="true">
        {face}
      </div>
      <span className={styles.seam} aria-hidden="true" />

      <div className={styles.controls}>
        <div className={styles.controlsBar}>
          <h2 id="vault-title" className="rv-visually-hidden">Retr0Vault</h2>
          <p id="vault-summary" className="rv-visually-hidden">
            A private archive of visual and motion references. {summary}
          </p>
          <span />
          <span className={styles.controlsEnd}>
            <span className={styles.status}>
              <ConnectionStatus />
            </span>
            <button type="button" className={styles.skip} onClick={finish}>
              Skip
            </button>
          </span>
        </div>
        <div />
        <div className={styles.enterRow}>
          <button ref={enter} type="button" className={styles.enter} onClick={() => void open()}>
            <span className={styles.enterSquare} aria-hidden="true" />
            Enter the vault
            <span className={styles.enterKey} aria-hidden="true">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
