import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ConnectionStatus } from "@/components/layout/ConnectionStatus";
import {
  LoginScene, endedLoginView, lockedLoginView, restingLoginView, type LoginFocus, type LoginMode, type LoginStamp, type LoginView,
} from "@/components/vault/LoginScene";
import { SleepDial } from "@/components/vault/SleepDial";
import { useDoors } from "@/components/vault/VaultDoors";
import { ApiError } from "@/lib/api/client";
import { signIn } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";
import { forgetAccountQueries, useSession } from "@/lib/auth/session";
import { useReducedMotion } from "@/lib/motion/preferences";
import { useFrontDoor } from "@/lib/vault/frontDoor";
import { holdPageStill } from "@/lib/vault/scrollLock";

/*
 * `/login` — the strong room behind the front door. Holds the state machine;
 * `LoginScene` draws it.
 *
 *   idle ──submit──▶ verifying ──401──▶ denied ──(a moment)──▶ idle
 *                        │    └──429──▶ throttled ──(countdown)──▶ idle
 *                        └──200──▶ granted ──▶ the doors part (up and down)
 */


const DEGREES_PER_NUMBER = 6;
/** The drama of turning the tumblers takes at least this long, however fast the API answers. */
const MIN_VERIFY_MS = 1_150;
const GRANTED_HOLD_MS = 950;
const DENIED_HOLD_MS = 1_700;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A cubic ease-out (or, with `overshoot`, a back-out) tween; instant without a frame loop. */
function tween(from: number, to: number, ms: number, apply: (value: number) => void, overshoot = 0): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function" || ms <= 0) {
      apply(to);
      resolve();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      const eased = overshoot > 0
        ? 1 + (overshoot + 1) * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2)
        : 1 - Math.pow(1 - t, 3);
      apply(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** The number a character sets the dial to, so the combination has a visible shape. */
function numberFor(character: string, position: number): number {
  return ((character.codePointAt(0) ?? 0) * 7 + position * 13) % 60;
}

let measuring: CanvasRenderingContext2D | null | undefined;

/** The text's width in the input's font, for the carriage and the lens's gaze. */
function textWidth(input: HTMLInputElement, text: string): number {
  if (measuring === undefined) {
    try {
      measuring = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      measuring = null;
    }
  }
  if (measuring === null || measuring === undefined) return text.length * 14;
  const style = getComputedStyle(input);
  measuring.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measuring.measureText(text).width;
}

/** A gaze from the lens toward a point on screen, as a vector no longer than 1. */
function gazeToward(lens: Element | null | undefined, x: number, y: number): { x: number; y: number } {
  if (!lens) return { x: 0, y: 0 };
  const box = lens.getBoundingClientRect();
  const dx = x - (box.left + box.width / 2);
  const dy = y - (box.top + box.height / 2);
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return { x: 0, y: 0 };
  const reach = Math.min(1, distance / 260);
  return { x: (dx / distance) * reach, y: (dy / distance) * reach };
}

function pad(value: number): string {
  return String(Math.max(0, value)).padStart(2, "0");
}

export function LoginRoute() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const doors = useDoors();
  const frontDoor = useFrontDoor();
  const reduced = useReducedMotion();

  const arrivedThroughDoors = (location.state as { arrived?: unknown } | null)?.arrived === "doors";
  // The doors that brought the depositor here closed on their own: the session lapsed.
  const sessionEnded = (location.state as { ended?: unknown } | null)?.ended === true;
  const closedView = sessionEnded ? endedLoginView : lockedLoginView;
  const from = (location.state as { from?: unknown } | null)?.from;
  const destination = typeof from === "string" && from.startsWith("/") && !from.startsWith("/login") ? from : "/all";

  const sceneRef = useRef<HTMLDivElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const glyphsRef = useRef<HTMLSpanElement>(null);
  const turn = useRef(0);
  const leaving = useRef(false);
  const played = useRef(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [focus, setFocus] = useState<LoginFocus>("none");
  const [mode, setMode] = useState<LoginMode>("idle");
  // Arriving through the closing doors, the room matches the picture they bore.
  const [message, setMessage] = useState(arrivedThroughDoors ? closedView.message : restingLoginView.message);
  const [stamp, setStamp] = useState<LoginStamp | null>(null);
  const [jolt, setJolt] = useState(0);
  const [caret, setCaret] = useState(0);
  const [pointerGaze, setPointerGaze] = useState({ x: 0, y: 0 });
  const [retryUntil, setRetryUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // The strong room has no page to scroll behind it.
  useEffect(() => holdPageStill(), []);

  // Nothing read under a session that has ended waits here for the next depositor.
  useEffect(() => {
    if (session.data === null) forgetAccountQueries(client);
  }, [client, session.data]);

  const setTurn = useCallback((value: number) => {
    turn.current = value;
    sceneRef.current?.style.setProperty("--dial-turn", `${value}deg`);
  }, []);

  /** Turns the dial, frame by frame, outside React (a render mid-turn reads the live position). */
  const turnDial = useCallback(async (to: number, ms: number, overshoot = 0) => {
    await tween(turn.current, to, reduced ? 0 : ms, setTurn, overshoot);
  }, [reduced, setTurn]);

  // The pupil follows the pointer while nothing has the lens's attention.
  useEffect(() => {
    if (reduced || focus !== "none" || mode !== "idle") return undefined;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const gaze = gazeToward(sceneRef.current?.querySelector("[data-lens]"), event.clientX, event.clientY);
        setPointerGaze({ x: gaze.x * 0.8, y: gaze.y * 0.8 });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [focus, mode, reduced]);

  // The pause after too many tries counts down.
  useEffect(() => {
    if (mode !== "throttled") return undefined;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= retryUntil) {
        setMode("idle");
        setStamp(null);
        setMessage("The pause is over. Try the combination again.");
      }
    }, 250);
    return () => clearInterval(timer);
  }, [mode, retryUntil]);

  // Keep the pins over the hidden text when a long combination scrolls.
  const syncGlyphs = useCallback(() => {
    const input = passwordRef.current;
    if (input !== null && glyphsRef.current !== null) {
      glyphsRef.current.style.transform = `translateX(${-input.scrollLeft}px)`;
    }
  }, []);

  // --- where the lens looks, and how far its iris is open -----------------------
  const usernameInput = usernameRef.current;
  const measured = usernameInput === null ? 0 : textWidth(usernameInput, username.slice(0, caret));
  const carriage = usernameInput === null ? 0 : Math.min(1, measured / Math.max(1, usernameInput.clientWidth));

  let look = pointerGaze;
  const lens = sceneRef.current?.querySelector("[data-lens]");
  if (mode === "verifying" || mode === "granted") {
    look = { x: 0, y: 0 };
  } else if (focus === "username" && usernameInput !== null) {
    const box = usernameInput.getBoundingClientRect();
    look = gazeToward(lens, box.left + Math.min(measured, box.width), box.top + box.height / 2);
  } else if (focus === "password" && reveal && passwordRef.current !== null) {
    const box = passwordRef.current.getBoundingClientRect();
    look = gazeToward(lens, box.left + box.width * 0.3, box.top + box.height / 2);
  }

  const aperture = mode === "granted" || mode === "denied" ? 1
    : mode === "verifying" ? 0.28
      : focus === "password" ? (reveal ? 0.5 : 0)
        : 1;

  const view: LoginView = {
    username,
    passwordLength: [...password].length,
    reveal,
    focus,
    mode,
    dialTurn: turn.current,
    aperture,
    look,
    carriage,
    message: mode === "throttled"
      ? `Sign-in is paused. The vault listens again in 00:${pad(Math.ceil(Math.max(0, retryUntil - now) / 1_000))}.`
      : message,
    stamp,
    jolt,
  };
  const viewRef = useRef(view);
  viewRef.current = view;

  // --- typing ------------------------------------------------------------------
  const onUsername = useCallback((value: string, position: number) => {
    const grew = value.length > username.length;
    setUsername(value);
    setCaret(position);
    if (mode === "denied") setMode("idle");
    // Each letter clicks the dial one number round, and back for a deletion.
    void turnDial(turn.current + (grew ? DEGREES_PER_NUMBER : -DEGREES_PER_NUMBER), 160);
  }, [mode, turnDial, username.length]);

  const onPassword = useCallback((value: string) => {
    const characters = [...value];
    const previous = [...password].length;
    setPassword(value);
    if (mode === "denied") {
      setMode("idle");
      setStamp(null);
    }
    if (characters.length > previous) {
      // Like a real combination: each number is dialled in the opposite direction to the last.
      const position = characters.length - 1;
      const direction = position % 2 === 0 ? 1 : -1;
      const target = -numberFor(characters[position]!, position) * DEGREES_PER_NUMBER;
      let delta = (((target - turn.current) % 360) + 360) % 360;
      if (direction === -1) delta = delta === 0 ? -360 : delta - 360;
      else if (delta < 36) delta += 360;
      void turnDial(turn.current + delta, 360);
    } else if (characters.length < previous) {
      void turnDial(turn.current - DEGREES_PER_NUMBER * 3, 200);
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(syncGlyphs);
  }, [mode, password, syncGlyphs, turnDial]);

  const onFocus = useCallback((next: LoginFocus) => {
    setFocus(next);
    if (mode === "idle") {
      setMessage(next === "password" ? "Lens shut. The combination is yours alone."
        : next === "username" ? "The lens reads the depositor's name."
          : restingLoginView.message);
    }
  }, [mode]);

  const onReveal = useCallback(() => {
    setReveal((current) => !current);
    passwordRef.current?.focus();
  }, []);

  // --- opening --------------------------------------------------------------------
  const deny = useCallback(async (text: string) => {
    setMode("denied");
    setMessage(text);
    setStamp({ kind: "denied", text: "Access denied", detail: `Register · ${new Date().toLocaleTimeString("en-GB")}`, key: Date.now() });
    setJolt((value) => value + 1);
    // The dial snaps back to zero; the tumblers fall; the combination is wiped.
    await turnDial(Math.round(turn.current / 360) * 360, 520, 1.4);
    await wait(reduced ? 0 : 520);
    setPassword("");
    setReveal(false);
    passwordRef.current?.focus();
    await wait(reduced ? 0 : DENIED_HOLD_MS - 520);
    setStamp((current) => (current?.kind === "denied" ? null : current));
  }, [reduced, turnDial]);

  const submit = useCallback(async () => {
    if (mode === "verifying" || mode === "granted" || mode === "throttled" || leaving.current) return;
    const name = username.trim();
    if (name === "" || password === "") {
      setJolt((value) => value + 1);
      // Focus first: the field's own greeting must not replace the warning.
      (name === "" ? usernameRef : passwordRef).current?.focus();
      setMessage(name === "" ? "The vault needs a depositor's name first." : "The vault needs a combination.");
      return;
    }

    setMode("verifying");
    setStamp(null);
    setMessage("Turning the tumblers…");
    const started = Date.now();
    // The dial runs through a combination while the vault checks.
    const spinning = (async () => {
      const stops = [360 + 144, -252, 198];
      for (const step of stops) {
        if (Date.now() - started > MIN_VERIFY_MS) break;
        await turnDial(turn.current + step, 420);
      }
    })();

    try {
      const response = await signIn({ username: name, password });
      await Promise.all([spinning, wait(Math.max(0, MIN_VERIFY_MS - (Date.now() - started)))]);
      leaving.current = true;
      setMode("granted");
      setMessage(`Access granted. Welcome back, ${response.user.username}.`);
      setStamp({ kind: "granted", text: "Access granted", detail: response.user.username, key: Date.now() });
      // The index finds zero, the bolt goes home.
      await turnDial(Math.round(turn.current / 360) * 360, 700, 1.2);
      await wait(reduced ? 0 : GRANTED_HOLD_MS);
      const picture = <LoginScene view={{ ...viewRef.current, dialTurn: turn.current }} />;
      await doors.open(picture, async () => {
        forgetAccountQueries(client);
        client.setQueryData(queryKeys.session(), response);
        navigate(destination, { replace: true });
        // Let the vault's first plates arrive before the doors part, so they can be dealt in.
        const deadline = Date.now() + 1_800;
        while (document.querySelector("#catalogue article") === null && Date.now() < deadline) await wait(60);
      });
    } catch (error) {
      await spinning;
      if (error instanceof ApiError && error.statusCode === 429) {
        const seconds = Number(/(\d+) seconds/u.exec(error.message)?.[1] ?? "30");
        setRetryUntil(Date.now() + seconds * 1_000);
        setNow(Date.now());
        setMode("throttled");
        setJolt((value) => value + 1);
        setStamp({ kind: "paused", text: "Paused", detail: "Too many tries", key: Date.now() });
        await turnDial(Math.round(turn.current / 360) * 360, 520, 1.4);
        setPassword("");
      } else if (error instanceof ApiError && error.statusCode === 401) {
        await deny(error.message);
      } else {
        setMode("idle");
        setMessage(error instanceof ApiError && error.isOffline
          ? "The vault is not answering. Start it with npm run dev and try again."
          : "The vault could not check those credentials. Try again in a moment.");
      }
    }
  }, [client, deny, destination, doors, mode, navigate, password, reduced, turnDial, username]);

  // Already inside: there is nothing to sign in to.
  if (!leaving.current && !arrivedThroughDoors && session.data?.user !== undefined) {
    return <Navigate to={destination} replace />;
  }

  // Once the room has been seen, the front door closing over it again (the
  // vault put to sleep) leaves it as it is rather than winding its arrival back.
  if (frontDoor !== "sealed") played.current = true;
  const intro = arrivedThroughDoors ? "settled" : !played.current && frontDoor === "sealed" ? "wait" : "play";

  return (
    <LoginScene
      sceneRef={sceneRef}
      view={view}
      intro={intro}
      reduced={reduced}
      live={{
        password,
        usernameRef,
        passwordRef,
        glyphsRef,
        onUsername,
        onPassword,
        onCaret: setCaret,
        onFocus,
        onReveal,
        onSubmit: () => void submit(),
        onPasswordScroll: syncGlyphs,
        status: <ConnectionStatus />,
        frontDoor: (
          <SleepDial variant="link" label="Front door" />
        ),
      }}
    />
  );
}
