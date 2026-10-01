import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { LandingAtmosphere, LandingFieldCanvas } from "./LandingAtmosphere";

function clock() {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => { pending.delete(handle); });
  return {
    pending,
    advance(milliseconds: number) {
      now += milliseconds;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    },
  };
}

function surfaces() {
  const contexts: Array<ReturnType<typeof context>> = [];
  function context() {
    return {
      clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      arc: vi.fn(), ellipse: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
      setLineDash: vi.fn(), translate: vi.fn(), scale: vi.fn(), rotate: vi.fn(), drawImage: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    };
  }
  vi.spyOn(HTMLCanvasElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLCanvasElement.prototype, "clientHeight", "get").mockReturnValue(466);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const next = context();
    contexts.push(next);
    return next as unknown as CanvasRenderingContext2D;
  });
  return contexts;
}

function Scene({ running = true, reduced = false }: {
  running?: boolean; reduced?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <button type="button">Preview control</button>
      <LandingFieldCanvas /><LandingFieldCanvas />
      <LandingAtmosphere root={root} running={running} reduced={reduced} />
    </div>
  );
}

afterEach(() => {
  Reflect.deleteProperty(document, "hidden");
  window.sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe("landing field lifecycle", () => {
  it("uses one loop and one drawing for both door halves, including after StrictMode remount", () => {
    const frames = clock();
    const contexts = surfaces();
    const view = render(<StrictMode><Scene /></StrictMode>);
    const primary = contexts.at(-2)!;
    const copy = contexts.at(-1)!;
    expect(frames.pending.size).toBe(1);
    expect(primary.stroke).toHaveBeenCalled();
    expect(copy.stroke).not.toHaveBeenCalled();
    expect(copy.drawImage).toHaveBeenCalledTimes(1);
    frames.advance(17);
    const paints = primary.clearRect.mock.calls.length;
    frames.advance(16);
    expect(primary.clearRect).toHaveBeenCalledTimes(paints);
    frames.advance(17);
    expect(primary.clearRect).toHaveBeenCalledTimes(paints + 1);
    expect(copy.drawImage.mock.calls.length).toBe(primary.clearRect.mock.calls.length);
    view.unmount();
    expect(frames.pending.size).toBe(0);
  });

  it("parks during door movement, resumes afterwards, and freezes for reduced motion", () => {
    const frames = clock();
    surfaces();
    const view = render(<Scene />);
    expect(frames.pending.size).toBe(1);
    view.rerender(<Scene running={false} />);
    expect(frames.pending.size).toBe(0);
    view.rerender(<Scene running />);
    expect(frames.pending.size).toBe(1);
    view.rerender(<Scene reduced />);
    expect(frames.pending.size).toBe(0);

  });

  it("stops in hidden tabs and removes its visibility listener on unmount", () => {
    const frames = clock();
    surfaces();
    const view = render(<Scene />);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.pending.size).toBe(0);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.pending.size).toBe(1);
    view.unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.pending.size).toBe(0);
  });

  it("ripples a paper click, ignores controls and secondary clicks, and removes the listener", () => {
    const frames = clock();
    const contexts = surfaces();
    const view = render(<Scene />);
    const primary = contexts[0]!;
    const root = view.container.firstElementChild!;
    const press = (target: Element, button = 0) => target.dispatchEvent(new MouseEvent("pointerdown", {
      clientX: 1000, clientY: 300, button, bubbles: true,
    }));
    press(screen.getByRole("button", { name: "Preview control" }));
    press(root, 2);
    frames.advance(34);
    expect(primary.arc).not.toHaveBeenCalled();
    press(root);
    frames.advance(34);
    expect(primary.arc).toHaveBeenCalledWith(1000, 300, expect.any(Number), 0, Math.PI * 2);
    primary.arc.mockClear();
    view.rerender(<Scene running={false} />);
    frames.advance(34);
    expect(primary.arc).not.toHaveBeenCalled();
    view.unmount();
    press(root);
    expect(frames.pending.size).toBe(0);
  });

  it.each([
    { split: "left/right", openLeft: -640, openTop: 52, pointerX: 90 },
    { split: "left/right", openLeft: -640, openTop: 52, pointerX: 1190 },
    { split: "up/down", openLeft: 0, openTop: -308, pointerX: 90 },
    { split: "up/down", openLeft: 0, openTop: -308, pointerX: 1190 },
  ])("keeps pointer tracking and click ripples aligned after $split doors close at x=$pointerX", ({ openLeft, openTop, pointerX }) => {
    const contexts = surfaces();
    let canvasBox = new DOMRect(0, 52, 1280, 466);
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(() => canvasBox);
    vi.spyOn(HTMLCanvasElement.prototype, "offsetTop", "get").mockReturnValue(52);

    const interact = (closing: boolean) => {
      const frames = clock();
      canvasBox = new DOMRect(closing ? openLeft : 0, closing ? openTop : 52, 1280, 466);
      const view = render(<Scene running={!closing} />);
      const primary = contexts.at(-2)!;
      // Transforms move the doors without resizing their canvases.
      canvasBox = new DOMRect(0, 52, 1280, 466);
      if (closing) view.rerender(<Scene running />);
      primary.moveTo.mockClear();
      const root = view.container.firstElementChild!;
      root.dispatchEvent(new MouseEvent("pointermove", { clientX: pointerX, clientY: 280, bubbles: true }));
      root.dispatchEvent(new MouseEvent("pointerdown", { clientX: pointerX, clientY: 280, button: 0, bubbles: true }));
      frames.advance(34);
      const result = { marks: [...primary.moveTo.mock.calls], ripple: [...primary.arc.mock.calls] };
      view.unmount();
      return result;
    };

    const firstVisit = interact(false);
    expect(firstVisit.ripple).toEqual([[pointerX, 228, expect.any(Number), 0, Math.PI * 2]]);
    expect(interact(true)).toEqual(firstVisit);
  });

  it("draws a static map with no scheduled animation", () => {
    const frames = clock();
    const contexts = surfaces();
    render(<Scene reduced />);
    expect(contexts[1]!.drawImage).toHaveBeenCalledTimes(1);
    expect(frames.pending.size).toBe(0);
    expect(document.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("canvas")!.style.pointerEvents).toBe("none");
  });
});
