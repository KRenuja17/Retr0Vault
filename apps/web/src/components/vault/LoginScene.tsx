import { useId, useMemo, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from "react";

import { cx } from "@/lib/cx";

import { SleepDial } from "./SleepDial";

import styles from "./LoginScene.module.css";

/*
 * The strong room: the page the vault's front door opens onto, where a
 * depositor presents a name and a combination.
 *
 *   ┌ Retr0Vault — strong room ─────── Authorised depositors only ──── API ┐
 *   │            ▼                                                        │
 *   │       ╭─ dial ─╮          ■ STRONG ROOM · ACCESS REGISTER            │
 *   │       │ (lens) │          Present your credentials.                  │
 *   │       ╰────────╯          DEPOSITOR  ____________  carriage ─┬──     │
 *   │     ▮ ▮ ▮ ▮ ▯ ▯ ▯          COMBINATION ▮▮▮▮▮▮▮     [◉ REVEAL]        │
 *   │     TUMBLERS 04 · 12       [■ OPEN THE STRONG ROOM ↵]                 │
 *   └ ← Front door ───────────── Press ↵ to open ────── Web 4610 · API 4611 ┘
 *
 * The dial at the room's left is the front door's accent 0, grown; its hub is
 * a watchman's lens. While a name is typed the lens reads it; while the
 * combination is typed its iris shuts, and every character turns the dial and
 * sets a tumbler. The scene is also printed on the doors that part when the
 * vault opens, so it renders either live (with the form's bindings) or as a
 * still picture of one moment (`live` absent).
 */

export type LoginMode = "idle" | "verifying" | "denied" | "throttled" | "granted";
export type LoginFocus = "none" | "username" | "password";

export interface LoginStamp {
  readonly kind: "denied" | "granted" | "paused";
  readonly text: string;
  readonly detail: string;
  /** A new key replays the stamp. */
  readonly key: number;
}

/** Everything the scene shows, at one moment. */
export interface LoginView {
  readonly username: string;
  readonly passwordLength: number;
  readonly reveal: boolean;
  readonly focus: LoginFocus;
  readonly mode: LoginMode;
  readonly dialTurn: number;
  /** The iris: 0 shut, 1 wide open. */
  readonly aperture: number;
  /** Where the pupil looks, -1…1 on each axis. */
  readonly look: { readonly x: number; readonly y: number };
  /** The username carriage's position along its ruler, 0…1. */
  readonly carriage: number;
  readonly message: string;
  readonly stamp: LoginStamp | null;
  /** A new value jolts the card, like a lock that will not turn. */
  readonly jolt: number;
}

/** The room at rest: also the picture on the doors that close when the vault is locked. */
export const restingLoginView: LoginView = {
  username: "",
  passwordLength: 0,
  reveal: false,
  focus: "none",
  mode: "idle",
  dialTurn: 0,
  aperture: 1,
  look: { x: 0, y: 0 },
  carriage: 0,
  message: "The lens is watching. Present a name and a combination.",
  stamp: null,
  jolt: 0,
};

/** The room as locking the vault leaves it: also the picture on the doors that close. */
export const lockedLoginView: LoginView = {
  ...restingLoginView,
  message: "Vault locked. Present a name and a combination to return.",
};

/** The room as a lapsed session leaves it: the vault locked itself. */
export const endedLoginView: LoginView = {
  ...restingLoginView,
  message: "The session ended and the vault locked itself. Present a name and a combination to return.",
};

export interface LoginBindings {
  readonly password: string;
  readonly usernameRef: RefObject<HTMLInputElement | null>;
  readonly passwordRef: RefObject<HTMLInputElement | null>;
  readonly glyphsRef: RefObject<HTMLSpanElement | null>;
  readonly onUsername: (value: string, caret: number) => void;
  readonly onPassword: (value: string) => void;
  readonly onCaret: (caret: number) => void;
  readonly onFocus: (focus: LoginFocus) => void;
  readonly onReveal: () => void;
  readonly onSubmit: () => void;
  readonly onPasswordScroll: () => void;
  /** The connection marginalia, top right. */
  readonly status: ReactNode;
  readonly frontDoor: ReactNode;
}

export interface LoginSceneProps {
  readonly view: LoginView;
  /** Absent: a still picture (on a door), inert and without an intro. */
  readonly live?: LoginBindings;
  /** Play the arrival, hold it (behind the front door), or arrive already settled. */
  readonly intro?: "play" | "wait" | "settled";
  readonly reduced?: boolean;
  readonly sceneRef?: RefObject<HTMLDivElement | null>;
}

const DEGREES_PER_NUMBER = 6;
const TUMBLERS = 12;
const LEAVES = 8;

function pad(value: number, digits = 2): string {
  return String(Math.max(0, Math.round(value))).padStart(digits, "0");
}

function Dial() {
  const ticks = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);
  return (
    <svg className={styles.dialSvg} viewBox="0 0 240 240" focusable="false" aria-hidden="true">
      <circle className={styles.bezel} cx="120" cy="120" r="117" />
      <g className={styles.dialFace}>
        {ticks.map((index) => {
          const major = index % 5 === 0;
          return (
            <line
              key={index}
              className={cx(styles.tick, major && styles.tickMajor)}
              style={{ "--i": index } as CSSProperties}
              x1="120"
              y1={major ? 8 : 13}
              x2="120"
              y2="24"
              transform={`rotate(${index * DEGREES_PER_NUMBER} 120 120)`}
            />
          );
        })}
        {ticks.filter((index) => index % 5 === 0).map((index) => (
          <text key={`n${index}`} className={styles.dialNumber} x="120" y="40" transform={`rotate(${index * DEGREES_PER_NUMBER} 120 120)`}>
            {pad(index)}
          </text>
        ))}
        {/* The accent 0 of the wordmark: a heavy ring with one notch, so a turn can be seen. */}
        <circle className={styles.ring} cx="120" cy="120" r="72" pathLength="100" />
        <rect className={styles.notch} x="116.5" y="58" width="7" height="30" />
      </g>
    </svg>
  );
}

/** The watchman's lens in the dial's hub: a glass, a pupil, and an iris of eight leaves. */
function Lens() {
  return (
    <span className={styles.lens} data-lens="" aria-hidden="true">
      <span className={styles.glass}>
        <span className={styles.pupil} />
      </span>
      <span className={styles.iris}>
        {Array.from({ length: LEAVES }, (_, index) => (
          <span key={index} className={styles.leaf} style={{ "--i": index } as CSSProperties} />
        ))}
      </span>
      <span className={styles.lensRing} />
    </span>
  );
}

/**
 * The register's stamp, pressed onto the card: worn ink, a ring of ink
 * squeezed out on impact. The card sinks back beneath it while it is there.
 */
function Stamp({ stamp }: { readonly stamp: LoginStamp }) {
  return (
    <span className={cx(styles.stamp, styles[`stamp-${stamp.kind}`])} aria-hidden="true">
      <span className={styles.stampRing} />
      <span className={styles.stampInk}>
        <span className={styles.stampText}>{stamp.text}</span>
        <span className={styles.stampRule} />
        <span className={styles.stampDetail}>{stamp.detail}</span>
      </span>
    </span>
  );
}

export function LoginScene({ view, live, intro = "play", reduced = false, sceneRef }: LoginSceneProps) {
  const still = live === undefined;
  const pins = Math.min(view.passwordLength, TUMBLERS);
  const overflow = Math.max(0, view.passwordLength - TUMBLERS);
  const phaseClass = still || intro === "settled" ? styles.settled : intro === "wait" ? styles.waiting : styles.playing;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    live?.onSubmit();
  };

  const busy = view.mode === "verifying" || view.mode === "granted";
  const combinationId = useId();

  return (
    <div
      ref={sceneRef}
      className={cx(
        styles.scene,
        phaseClass,
        styles[view.mode],
        view.focus === "password" && styles.guarding,
        view.reveal && styles.revealing,
        (reduced || still) && styles.still,
      )}
      style={{
        "--dial-turn": `${view.dialTurn}deg`,
        "--open": view.aperture,
        "--look-x": view.look.x,
        "--look-y": view.look.y,
        "--carriage": view.carriage,
      } as CSSProperties}
      aria-hidden={still ? true : undefined}
      inert={still ? true : undefined}
    >
      <span className={cx(styles.registration, styles.registrationTopLeft)} />
      <span className={cx(styles.registration, styles.registrationTopRight)} />
      <span className={cx(styles.registration, styles.registrationBottomLeft)} />
      <span className={cx(styles.registration, styles.registrationBottomRight)} />
      <span className={cx(styles.ruler, styles.rulerLeft)} />
      <span className={cx(styles.ruler, styles.rulerRight)} />

      <header className={styles.bar}>
        <span className={cx(styles.mono, styles.typeIn)} style={{ "--d": "120ms" } as CSSProperties}>
          Retr0Vault — strong room
        </span>
        <span className={cx(styles.mono, styles.typeIn, styles.barCentre)} style={{ "--d": "220ms" } as CSSProperties}>
          Authorised depositors only
        </span>
        <span className={cx(styles.barEnd, styles.fade)} style={{ "--d": "600ms" } as CSSProperties}>
          {live?.status ?? <span className={styles.mono}>Vault · sealed</span>}
        </span>
      </header>

      <div className={styles.stage}>
        <section className={styles.lock} aria-hidden="true">
          <span className={styles.index} />
          <span className={styles.dial}>
            <Dial />
            <Lens />
          </span>
          <span className={styles.tumblers}>
            {Array.from({ length: TUMBLERS }, (_, index) => (
              <span key={index} className={styles.slot} style={{ "--i": index } as CSSProperties}>
                <span className={cx(styles.pin, index < pins && styles.pinSet)} />
              </span>
            ))}
          </span>
          <span className={cx(styles.mono, styles.readout)}>
            Tumblers <b>{pad(view.passwordLength)}</b>{overflow > 0 ? ` +${overflow}` : ""} · lens {view.aperture < 0.15 ? "shut" : view.aperture > 0.85 ? "open" : "ajar"}
          </span>
        </section>

        <form
          className={cx(
            styles.card,
            view.stamp !== null && styles.stamped,
            view.jolt % 2 === 1 ? styles.joltA : view.jolt > 0 ? styles.joltB : undefined,
          )}
          onSubmit={onSubmit}
          noValidate
          aria-labelledby="strong-room-title"
        >
          <span className={cx(styles.mono, styles.overline, styles.typeIn)} style={{ "--d": "520ms" } as CSSProperties}>
            <span className={styles.square} /> Strong room · Access register
            <span className={styles.folio}>No. 0001</span>
          </span>
          <h1 id="strong-room-title" className={cx(styles.heading, styles.rise)} style={{ "--d": "620ms" } as CSSProperties}>
            Present your credentials.
          </h1>
          <p className={cx(styles.lede, styles.rise)} style={{ "--d": "700ms" } as CSSProperties}>
            The vault reads a name, then turns to a combination only you should see.
          </p>

          <label className={cx(styles.field, styles.rise)} style={{ "--d": "780ms" } as CSSProperties}>
            <span className={cx(styles.mono, styles.fieldLabel)}>Depositor</span>
            <input
              ref={live?.usernameRef}
              className={styles.input}
              name="username"
              value={view.username}
              readOnly={still}
              tabIndex={still ? -1 : undefined}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={64}
              disabled={busy}
              onChange={(event) => live?.onUsername(event.target.value, event.target.selectionStart ?? event.target.value.length)}
              onSelect={(event) => live?.onCaret(event.currentTarget.selectionStart ?? 0)}
              onFocus={() => live?.onFocus("username")}
              onBlur={() => live?.onFocus("none")}
            />
            <span className={styles.carriage} aria-hidden="true">
              <span className={styles.carriageHead} />
            </span>
          </label>

          {/* The label names the input alone; the reveal switch sits beside it. */}
          <div className={cx(styles.field, styles.rise)} style={{ "--d": "860ms" } as CSSProperties}>
            <span className={cx(styles.mono, styles.fieldLabel)}>
              <label htmlFor={combinationId}>Combination</label>
              {still ? null : (
                <button
                  type="button"
                  className={styles.reveal}
                  aria-pressed={view.reveal}
                  onClick={live?.onReveal}
                  disabled={busy}
                >
                  <span className={styles.revealEye} aria-hidden="true" />
                  {view.reveal ? "Conceal" : "Reveal"}
                </button>
              )}
            </span>
            <span className={styles.combination}>
              <input
                ref={live?.passwordRef}
                id={combinationId}
                className={cx(styles.input, styles.secret, view.reveal && !still && styles.secretShown)}
                name="password"
                type={view.reveal && !still ? "text" : "password"}
                value={still ? "•".repeat(view.passwordLength) : live.password}
                readOnly={still}
                tabIndex={still ? -1 : undefined}
                autoComplete="current-password"
                spellCheck={false}
                maxLength={256}
                disabled={busy}
                onChange={(event) => live?.onPassword(event.target.value)}
                onScroll={live?.onPasswordScroll}
                onFocus={() => live?.onFocus("password")}
                onBlur={() => live?.onFocus("none")}
              />
              {/* The combination as tumbler pins, one per character, aligned with the hidden text. */}
              <span className={cx(styles.glyphs, view.reveal && !still && styles.glyphsHidden)} aria-hidden="true">
                <span ref={live?.glyphsRef} className={styles.glyphTrack}>
                  {Array.from({ length: view.passwordLength }, (_, index) => (
                    <span key={index} className={styles.glyph} />
                  ))}
                </span>
              </span>
            </span>
          </div>

          <div className={cx(styles.actions, styles.rise)} style={{ "--d": "960ms" } as CSSProperties}>
            <button type="submit" className={styles.open} disabled={busy || view.mode === "throttled"} tabIndex={still ? -1 : undefined}>
              <span className={styles.openSquare} aria-hidden="true" />
              {view.mode === "verifying" ? "Turning the tumblers" : view.mode === "granted" ? "Access granted" : "Open the strong room"}
              <span className={styles.openKey} aria-hidden="true">↵</span>
            </button>
          </div>

          <p
            className={cx(styles.message, view.mode === "denied" && styles.messageAlert)}
            role={view.mode === "denied" || view.mode === "throttled" ? "alert" : "status"}
          >
            <span className={styles.messageMark} aria-hidden="true" />
            {view.message}
          </p>

          {view.stamp === null ? null : <Stamp key={view.stamp.key} stamp={view.stamp} />}
        </form>
      </div>

      <footer className={styles.bar}>
        <span className={cx(styles.typeIn)} style={{ "--d": "1100ms" } as CSSProperties}>
          {live?.frontDoor ?? <SleepDial variant="link" label="Front door" still />}
        </span>
        <span className={cx(styles.mono, styles.typeIn, styles.barCentre)} style={{ "--d": "1180ms" } as CSSProperties}>
          Press ↵ to open
        </span>
        <span className={cx(styles.mono, styles.typeIn, styles.barEnd)} style={{ "--d": "1260ms" } as CSSProperties}>
          Sessions end after 14 days idle
        </span>
      </footer>
    </div>
  );
}
