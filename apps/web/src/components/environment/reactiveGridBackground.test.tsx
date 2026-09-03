import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ReactiveGridBackground } from "./ReactiveGridBackground";
import {
  FIELD_RADIUS,
  GRID_CELL,
  MAX_DISPLACEMENT,
  approach,
  clampShift,
  falloff,
} from "./gridField";

/*
 * jsdom paints nothing, so none of this asserts on pixels or on how the motion
 * looks. What is asserted is the contract the layer has with the page: it adds
 * no semantics, it never takes a pointer event, it obeys the motion
 * preference, it stops when the tab is hidden, and it leaves nothing behind.
 */

interface RecordedPoint {
  readonly x: number;
  readonly y: number;
}

interface StubContext {
  readonly points: RecordedPoint[];
  readonly strokes: () => number;
  readonly clears: () => number;
  readonly gradients: () => number;
}

/** A recording 2D context, in place of the one jsdom does not implement. */
function stubContext(): StubContext {
  const points: RecordedPoint[] = [];
  let strokes = 0;
  let clears = 0;
  let gradients = 0;

  const gradient = { addColorStop: vi.fn() };
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(() => {
      clears += 1;
    }),
    beginPath: vi.fn(),
    moveTo: vi.fn((x: number, y: number) => {
      points.push({ x, y });
    }),
    lineTo: vi.fn((x: number, y: number) => {
      points.push({ x, y });
    }),
    stroke: vi.fn(() => {
      strokes += 1;
    }),
    createRadialGradient: vi.fn(() => {
      gradients += 1;
      return gradient;
    }),
    lineWidth: 1,
    lineJoin: "miter",
    strokeStyle: "",
  };

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );

  return {
    points,
    strokes: () => strokes,
    clears: () => clears,
    gradients: () => gradients,
  };
}

interface FrameClock {
  readonly requested: () => number;
  readonly cancelled: () => number;
  readonly pending: () => number;
  readonly advance: (frames: number, stepMs?: number) => void;
}

/** Deterministic requestAnimationFrame, driven a frame at a time. */
function stubFrames(): FrameClock {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let requested = 0;
  let cancelled = 0;
  let now = 0;

  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number => {
      requested += 1;
      const id = nextId;
      nextId += 1;
      queue.set(id, callback);
      return id;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
    if (queue.delete(id)) cancelled += 1;
  });

  return {
    requested: () => requested,
    cancelled: () => cancelled,
    pending: () => queue.size,
    advance(frames, stepMs = 60) {
      for (let index = 0; index < frames; index += 1) {
        const callbacks = [...queue.values()];
        queue.clear();
        now += stepMs;
        for (const callback of callbacks) callback(now);
      }
    },
  };
}

interface MediaOptions {
  readonly reduce?: boolean;
  readonly coarse?: boolean;
}

function stubMedia(options: MediaOptions = {}): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: query.includes("prefers-reduced-motion")
      ? options.reduce === true
      : query.includes("pointer: coarse")
        ? options.coarse === true
        : false,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function movePointer(x: number, y: number): void {
  const init = { clientX: x, clientY: y, bubbles: true };
  const event =
    typeof PointerEvent === "function"
      ? new PointerEvent("pointermove", { ...init, pointerType: "mouse" })
      : new MouseEvent("pointermove", init);
  window.dispatchEvent(event);
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function canvasLayer(): HTMLCanvasElement {
  const canvas = document.querySelector("canvas");
  if (canvas === null) throw new Error("The environment layer did not mount.");
  return canvas;
}

afterEach(() => {
  Reflect.deleteProperty(document, "hidden");
});

describe("reactive grid background", () => {
  it("adds a layer to the page without adding anything to its semantics", () => {
    stubMedia();
    stubFrames();
    stubContext();

    render(
      <>
        <ReactiveGridBackground />
        <main>
          <h1>Retr0Vault</h1>
          <button type="button">Add reference</button>
        </main>
      </>,
    );

    expect(screen.getByRole("heading", { name: "Retr0Vault" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add reference" })).toBeInTheDocument();
    expect(screen.getByRole("main").childElementCount).toBe(2);
    expect(canvasLayer()).not.toHaveAccessibleName();
  });

  it("presents the canvas as decoration that cannot take a pointer event", () => {
    stubMedia();
    stubFrames();
    stubContext();

    render(<ReactiveGridBackground />);
    const canvas = canvasLayer();

    expect(canvas).toHaveAttribute("role", "presentation");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).not.toHaveAttribute("tabindex");
    expect(canvas.style.pointerEvents).toBe("none");
  });

  it("keeps a static grid and never animates under prefers-reduced-motion", () => {
    stubMedia({ reduce: true });
    const frames = stubFrames();
    const context = stubContext();

    render(<ReactiveGridBackground />);
    expect(context.strokes()).toBe(1);

    movePointer(400, 300);

    expect(frames.requested()).toBe(0);
    expect(context.strokes()).toBe(1);
    expect(context.gradients()).toBe(0);
  });

  it("keeps a static grid for a coarse pointer", () => {
    stubMedia({ coarse: true });
    const frames = stubFrames();
    const context = stubContext();

    render(<ReactiveGridBackground />);
    movePointer(400, 300);

    expect(frames.requested()).toBe(0);
    expect(context.strokes()).toBe(1);
  });

  it("keeps breathing around a pointer that has stopped moving", () => {
    stubMedia();
    const frames = stubFrames();
    const context = stubContext();

    render(<ReactiveGridBackground />);
    movePointer(400, 300);

    /* Let the centre and the presence envelope settle before comparing. */
    frames.advance(60);
    context.points.length = 0;
    frames.advance(1);
    const before = [...context.points];

    /* Half a second of time passing, with the pointer untouched. */
    context.points.length = 0;
    frames.advance(8);
    const after = context.points.slice(-before.length);

    expect(after).toHaveLength(before.length);

    let movedNear = 0;
    let movedFar = 0;
    for (const [index, start] of before.entries()) {
      const end = after[index];
      if (end === undefined) continue;
      const delta = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      const distance = Math.hypot(start.x - 400, start.y - 300);
      if (distance < 120 && delta > 0.1) movedNear += 1;
      if (distance > FIELD_RADIUS + GRID_CELL && delta > 0) movedFar += 1;
    }

    expect(movedNear).toBeGreaterThan(0);
    expect(movedFar).toBe(0);
  });

  it("stops while the document is hidden and resumes when it comes back", () => {
    stubMedia();
    const frames = stubFrames();
    stubContext();

    render(<ReactiveGridBackground />);
    movePointer(400, 300);
    expect(frames.pending()).toBe(1);

    setHidden(true);
    expect(frames.cancelled()).toBe(1);
    expect(frames.pending()).toBe(0);

    setHidden(false);
    expect(frames.pending()).toBe(1);
  });

  it("redraws on resize and stops listening once unmounted", () => {
    stubMedia();
    stubFrames();
    const context = stubContext();
    const removeListener = vi.spyOn(window, "removeEventListener");

    const view = render(<ReactiveGridBackground />);
    const drawnOnMount = context.clears();

    window.dispatchEvent(new Event("resize"));
    expect(context.clears()).toBe(drawnOnMount + 1);

    view.unmount();

    const removed = removeListener.mock.calls.map(([type]) => type);
    expect(removed).toContain("resize");
    expect(removed).toContain("pointermove");

    const settled = context.clears();
    window.dispatchEvent(new Event("resize"));
    movePointer(120, 120);
    expect(context.clears()).toBe(settled);
  });

  it("cancels its pending frame on unmount", () => {
    stubMedia();
    const frames = stubFrames();
    stubContext();

    const view = render(<ReactiveGridBackground />);
    movePointer(400, 300);
    expect(frames.pending()).toBe(1);

    view.unmount();

    expect(frames.cancelled()).toBe(1);
    expect(frames.pending()).toBe(0);
  });
});

describe("reactive grid field", () => {
  it("reaches full strength at the centre and exactly nothing at the rim", () => {
    expect(falloff(0)).toBe(1);
    expect(falloff(FIELD_RADIUS)).toBe(0);
    expect(falloff(FIELD_RADIUS + GRID_CELL)).toBe(0);
  });

  it("falls off smoothly, and is strongest across the inner band", () => {
    let previous = falloff(0);
    for (let distance = 10; distance <= FIELD_RADIUS; distance += 10) {
      const current = falloff(distance);
      expect(current).toBeLessThan(previous);
      previous = current;
    }

    expect(falloff(100)).toBeGreaterThan(0.6);
    expect(falloff(130)).toBeGreaterThan(0.5);
    expect(falloff(250)).toBeLessThan(0.1);
  });

  it("never lets a line travel past the lattice's limit", () => {
    expect(clampShift(40)).toBe(MAX_DISPLACEMENT);
    expect(clampShift(-40)).toBe(-MAX_DISPLACEMENT);
    expect(clampShift(1.2)).toBe(1.2);
  });

  it("approaches a target at a frame-rate independent rate", () => {
    const oneStep = approach(0, 100, 6.5, 1 / 30);
    let twoSteps = approach(0, 100, 6.5, 1 / 60);
    twoSteps = approach(twoSteps, 100, 6.5, 1 / 60);

    expect(twoSteps).toBeCloseTo(oneStep, 8);
  });
});
