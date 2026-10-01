import { StrictMode, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingAtmosphere, LandingEffectPicker, LandingFieldCanvas, useLandingEffect } from "./LandingAtmosphere";
import type { LandingEffect } from "./landingField";

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

function Scene({ effect = "engraving", running = true, reduced = false }: {
  effect?: LandingEffect; running?: boolean; reduced?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <LandingFieldCanvas /><LandingFieldCanvas />
      <LandingAtmosphere root={root} effect={effect} running={running} reduced={reduced} />
    </div>
  );
}

function Desk() {
  const [effect, change] = useLandingEffect();
  return <LandingEffectPicker effect={effect} onChange={change} />;
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
    view.rerender(<Scene effect="none" />);
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

  it.each(["engraving", "orrery", "halftone"] as const)("draws a static %s with no scheduled animation", (effect) => {
    const frames = clock();
    const contexts = surfaces();
    render(<Scene effect={effect} reduced />);
    expect(contexts[1]!.drawImage).toHaveBeenCalledTimes(1);
    expect(frames.pending.size).toBe(0);
    expect(document.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector("canvas")!.style.pointerEvents).toBe("none");
  });
});

describe("temporary effect comparison desk", () => {
  it("switches by keyboard without sending Enter to the vault, and remembers the choice on remount", async () => {
    vi.stubEnv("DEV", true);
    const entered = vi.fn();
    window.addEventListener("keydown", entered);
    try {
      const view = render(<Desk />);
      const option = screen.getByRole("button", { name: "Ink tides" });
      option.focus();
      await userEvent.keyboard("{Enter}");
      expect(option).toHaveAttribute("aria-pressed", "true");
      expect(entered).not.toHaveBeenCalled();
      view.unmount();
      render(<Desk />);
      expect(screen.getByRole("button", { name: "Ink tides" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByRole("button", { name: /Next landing effect/ }));
      expect(screen.getByRole("button", { name: "Plain paper" })).toHaveAttribute("aria-pressed", "true");
    } finally {
      window.removeEventListener("keydown", entered);
    }
  });

  it("does not ship the comparison controls in production", () => {
    vi.stubEnv("DEV", false);
    render(<Desk />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
