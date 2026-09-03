import { useEffect, useRef } from "react";

import {
  ALPHA_BASE,
  ALPHA_FIELD,
  FIELD_INERTIA,
  FIELD_RADIUS,
  GRID_CELL,
  IDLE_AMPLITUDE,
  POINTER_AMPLITUDE,
  PRESENCE_RATE,
  SAMPLE_STEP,
  approach,
  clampShift,
  falloff,
  falloffAt,
  idleWaveX,
  idleWaveY,
} from "./gridField";
import styles from "./ReactiveGridBackground.module.css";

/** Retina is worth paying for; anything past 2x is not. */
const MAX_DPR = 2;

/** Colour stops used to paint the contrast field. */
const GRADIENT_STOPS = 7;

/** A line this far outside the field cannot be moving, so it is drawn straight. */
const FIELD_REACH = FIELD_RADIUS + GRID_CELL;

/** Below this the field is treated as absent and the lattice as static. */
const PRESENCE_EPSILON = 0.002;

const INK_FALLBACK = "23, 20, 15";

function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/** The archive's ink, as channels, so the canvas can vary only its alpha. */
function readInk(): string {
  if (typeof window.getComputedStyle !== "function") return INK_FALLBACK;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--rv-grid-ink")
    .trim();
  return value === "" ? INK_FALLBACK : value;
}

/**
 * Wires one canvas to the pointer and to the frame loop, and hands back the
 * teardown. Split out of the component so the null checks on the canvas and
 * its context hold for the whole loop rather than being re-proved per frame.
 */
function attachGrid(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): () => void {
  const reduceQuery = mediaQuery("(prefers-reduced-motion: reduce)");
  const coarseQuery = mediaQuery("(pointer: coarse)");

  const ink = readInk();
  const baseStroke = `rgba(${ink}, ${ALPHA_BASE})`;

  /*
   * Everything the frame loop touches lives here rather than in React state:
   * a re-render per frame is exactly what this component must not do.
   */
  let width = 0;
  let height = 0;
  let dpr = 1;
  let pointerX = 0;
  let pointerY = 0;
  let fieldX = 0;
  let fieldY = 0;
  let presence = 0;
  let presenceTarget = 0;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;

  /*
   * The gradient is the one object rebuilt inside the loop, so it is reused
   * until the field has actually moved far enough to look different.
   */
  let gradient: CanvasGradient | null = null;
  let gradientX = Number.NaN;
  let gradientY = Number.NaN;
  let gradientPresence = -1;

  function isStatic(): boolean {
    return reduceQuery?.matches === true || coarseQuery?.matches === true;
  }

  function measure(): boolean {
    const cssWidth =
      canvas.clientWidth ||
      document.documentElement.clientWidth ||
      window.innerWidth;
    const cssHeight =
      canvas.clientHeight ||
      document.documentElement.clientHeight ||
      window.innerHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return false;

    width = cssWidth;
    height = cssHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    gradient = null;
    return true;
  }

  /** Ink alpha ramped from the field centre out to plain paper at the rim. */
  function fieldStroke(): CanvasGradient {
    if (
      gradient !== null &&
      Math.abs(fieldX - gradientX) < 0.75 &&
      Math.abs(fieldY - gradientY) < 0.75 &&
      Math.abs(presence - gradientPresence) < 0.004
    ) {
      return gradient;
    }

    const next = context.createRadialGradient(
      fieldX,
      fieldY,
      0,
      fieldX,
      fieldY,
      FIELD_RADIUS,
    );
    for (let stop = 0; stop < GRADIENT_STOPS; stop += 1) {
      const t = stop / (GRADIENT_STOPS - 1);
      const alpha =
        ALPHA_BASE + (ALPHA_FIELD - ALPHA_BASE) * falloffAt(t) * presence;
      next.addColorStop(t, `rgba(${ink}, ${alpha.toFixed(4)})`);
    }

    gradient = next;
    gradientX = fieldX;
    gradientY = fieldY;
    gradientPresence = presence;
    return next;
  }

  function influenceAt(x: number, y: number): number {
    const dx = fieldX - x;
    const dy = fieldY - y;
    return falloff(Math.sqrt(dx * dx + dy * dy)) * presence;
  }

  function shiftX(x: number, y: number, time: number): number {
    const influence = influenceAt(x, y);
    if (influence <= 0) return 0;
    const idle = idleWaveX(x, y, time) * IDLE_AMPLITUDE * influence;
    const pull = ((fieldX - x) / FIELD_RADIUS) * POINTER_AMPLITUDE * influence;
    return clampShift(idle + pull);
  }

  function shiftY(x: number, y: number, time: number): number {
    const influence = influenceAt(x, y);
    if (influence <= 0) return 0;
    const idle = idleWaveY(x, y, time) * IDLE_AMPLITUDE * influence;
    const pull = ((fieldY - y) / FIELD_RADIUS) * POINTER_AMPLITUDE * influence;
    return clampShift(idle + pull);
  }

  function draw(time: number): void {
    if (width <= 0 || height <= 0) return;

    const active = presence > PRESENCE_EPSILON;
    /*
     * Half a device pixel, so an undisplaced hairline lands on one row of
     * pixels rather than straddling two and rendering at half strength.
     */
    const hairline = 0.5 / dpr;
    const left = -GRID_CELL;
    const top = -GRID_CELL;
    const right = width + GRID_CELL;
    const bottom = height + GRID_CELL;

    context.clearRect(0, 0, width, height);
    context.lineWidth = Math.max(0.5, 1 / dpr);
    context.lineJoin = "round";
    context.strokeStyle = active ? fieldStroke() : baseStroke;
    context.beginPath();

    for (let x = left; x <= right; x += GRID_CELL) {
      const base = x + hairline;
      if (!active || Math.abs(x - fieldX) > FIELD_REACH) {
        context.moveTo(base, top);
        context.lineTo(base, bottom);
        continue;
      }
      context.moveTo(base + shiftX(x, top, time), top);
      for (let y = top + SAMPLE_STEP; y < bottom; y += SAMPLE_STEP) {
        context.lineTo(base + shiftX(x, y, time), y);
      }
      context.lineTo(base + shiftX(x, bottom, time), bottom);
    }

    for (let y = top; y <= bottom; y += GRID_CELL) {
      const base = y + hairline;
      if (!active || Math.abs(y - fieldY) > FIELD_REACH) {
        context.moveTo(left, base);
        context.lineTo(right, base);
        continue;
      }
      context.moveTo(left, base + shiftY(left, y, time));
      for (let x = left + SAMPLE_STEP; x < right; x += SAMPLE_STEP) {
        context.lineTo(x, base + shiftY(x, y, time));
      }
      context.lineTo(right, base + shiftY(right, y, time));
    }

    context.stroke();
  }

  function step(now: number): void {
    frame = 0;
    const seconds =
      lastTime === 0 ? 1 / 60 : Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsed += seconds;

    fieldX = approach(fieldX, pointerX, FIELD_INERTIA, seconds);
    fieldY = approach(fieldY, pointerY, FIELD_INERTIA, seconds);
    presence = approach(presence, presenceTarget, PRESENCE_RATE, seconds);

    /*
     * Once the pointer is gone the lattice is static again, so the loop stops
     * rather than repainting an identical frame forever.
     */
    if (presenceTarget === 0 && presence < PRESENCE_EPSILON) {
      presence = 0;
      draw(elapsed);
      return;
    }

    draw(elapsed);
    frame = requestAnimationFrame(step);
  }

  function start(): void {
    if (frame !== 0 || isStatic() || document.hidden) return;
    lastTime = 0;
    frame = requestAnimationFrame(step);
  }

  function stop(): void {
    if (frame === 0) return;
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function handlePointerMove(event: PointerEvent): void {
    if (isStatic()) return;
    /* Coarse pointers are already excluded by media query; this catches a
     * touch on a device that also reports a fine pointer. */
    if (event.pointerType === "touch") return;

    pointerX = event.clientX;
    pointerY = event.clientY;
    /*
     * First contact places the centre outright; letting it fly in from the
     * origin would drag a visible wave across the page.
     */
    if (presenceTarget === 0 && presence <= PRESENCE_EPSILON) {
      fieldX = pointerX;
      fieldY = pointerY;
    }
    presenceTarget = 1;
    start();
  }

  function handlePointerGone(): void {
    presenceTarget = 0;
    start();
  }

  function handleResize(): void {
    if (!measure()) return;
    if (frame === 0) draw(elapsed);
  }

  function handleVisibility(): void {
    if (document.hidden) {
      stop();
      return;
    }
    start();
  }

  function handleMotionPreference(): void {
    if (!isStatic()) {
      start();
      return;
    }
    stop();
    presence = 0;
    presenceTarget = 0;
    draw(elapsed);
  }

  measure();
  draw(0);

  window.addEventListener("resize", handleResize);
  window.addEventListener("blur", handlePointerGone);
  document.addEventListener("visibilitychange", handleVisibility);
  if (!isStatic()) {
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerGone);
  }
  reduceQuery?.addEventListener?.("change", handleMotionPreference);

  return () => {
    stop();
    window.removeEventListener("resize", handleResize);
    window.removeEventListener("blur", handlePointerGone);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerleave", handlePointerGone);
    document.removeEventListener("visibilitychange", handleVisibility);
    reduceQuery?.removeEventListener?.("change", handleMotionPreference);
  };
}

/**
 * The archive's environment layer: a very faint 50px lattice across the
 * viewport, which deforms and gains a little contrast around the pointer.
 *
 * The deformation is a field, not a hover state. A centre chases the pointer
 * with inertia; within ~280px of it the lattice is displaced by a smooth radial
 * falloff, and that displacement is driven by time as well as by position, so
 * the grid keeps breathing around a pointer that has stopped moving. Nothing in
 * the document is touched: this is one fixed, pointer-transparent canvas drawn
 * from local state on requestAnimationFrame, and React never re-renders for it.
 */
export function ReactiveGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const context = canvas.getContext("2d");
    if (context === null) return;

    return attachGrid(canvas, context);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      style={{ pointerEvents: "none" }}
      role="presentation"
      aria-hidden="true"
    />
  );
}
