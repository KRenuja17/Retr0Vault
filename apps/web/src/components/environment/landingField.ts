export type LandingEffect = "engraving" | "orrery" | "halftone" | "none";

export const LANDING_EFFECTS: readonly { id: LandingEffect; name: string; detail: string }[] = [
  { id: "engraving", name: "Engraved currents", detail: "Two contour plates drift out of register. Move the pointer to bend the ink." },
  { id: "orrery", name: "Archive orrery", detail: "An instrument of orbiting rings and moving index marks. The pointer tilts its axis." },
  { id: "halftone", name: "Ink tides", detail: "Waves of halftone ink cross the paper. The pointer leaves a moving impression." },
  { id: "none", name: "Plain paper", detail: "The original paper, for comparison." },
];

const TAU = Math.PI * 2;
const INK = "23, 20, 15";
const ACCENT = "180, 71, 42";
const FRAME_MS = 1000 / 30;

interface Field {
  width: number;
  height: number;
  time: number;
  x: number;
  y: number;
  presence: number;
}

/** One drawing, copied onto both door faces: their print always meets at the seam. */
export interface LandingFieldController {
  setRunning(running: boolean): void;
  dispose(): void;
}

function engraving(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const scale = Math.min(w, h * 1.9);
  for (let plate = 0; plate < 2; plate += 1) {
    const cx = w * (plate === 0 ? 0.04 : 0.96) + Math.sin(t * 0.22 + plate * 3) * 24;
    const cy = h * (plate === 0 ? 0.59 : 0.27) + Math.cos(t * 0.18 + plate * 2) * 20;
    for (let ring = 0; ring < 42; ring += 1) {
      const radius = scale * (0.045 + ring * 0.013);
      ctx.strokeStyle = ring % 9 === 0 ? `rgba(${ACCENT}, 0.42)` : `rgba(${INK}, 0.22)`;
      ctx.lineWidth = ring % 9 === 0 ? 1.25 : 0.8;
      ctx.beginPath();
      for (let sample = 0; sample <= 120; sample += 1) {
        const a = sample / 120 * TAU;
        const ripple = Math.sin(a * 3 + t * 0.24 + ring * 0.09) * 0.055
          + Math.cos(a * 5 - t * 0.17 + plate) * 0.028;
        let x = cx + Math.cos(a) * radius * (1 + ripple);
        let y = cy + Math.sin(a) * radius * 0.82 * (1 + ripple);
        const dx = x - field.x;
        const dy = y - field.y;
        const pull = Math.exp(-(dx * dx + dy * dy) / 48000) * field.presence;
        x += dx * pull * 0.12;
        y += dy * pull * 0.12;
        if (sample === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

function orrery(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const radius = Math.max(w * 0.38, h * 0.8);
  const lean = ((field.x / w) - 0.5) * field.presence * 0.2;
  const squeeze = 0.64 + ((field.y / h) - 0.5) * field.presence * 0.1;
  ctx.save();
  ctx.translate(w * 0.5, h * 0.48);
  ctx.rotate(-0.2 + Math.sin(t * 0.12) * 0.08 + lean);
  for (let ring = 0; ring < 20; ring += 1) {
    const r = radius * (0.3 + ring * 0.047);
    const angle = t * (ring % 2 === 0 ? 0.07 : -0.045) + ring * 0.63;
    ctx.strokeStyle = ring % 5 === 0 ? `rgba(${ACCENT}, 0.48)` : `rgba(${INK}, 0.24)`;
    ctx.lineWidth = ring % 5 === 0 ? 1.35 : 0.8;
    ctx.setLineDash(ring % 3 === 0 ? [3, 9] : []);
    ctx.lineDashOffset = -t * 5;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * squeeze, 0, angle, angle + TAU * 0.88);
    ctx.stroke();
    ctx.setLineDash([]);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r * squeeze;
    ctx.fillStyle = ring % 5 === 0 ? `rgba(${ACCENT}, 0.8)` : `rgba(${INK}, 0.55)`;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  // An outer instrument scale: major ticks carry small typeset indexes.
  ctx.font = '9px "JetBrains Mono Variable", monospace';
  for (let tick = 0; tick < 80; tick += 1) {
    const angle = tick / 80 * TAU + t * 0.018;
    const r = radius * 1.26;
    const inner = r - (tick % 5 === 0 ? 14 : 5);
    ctx.strokeStyle = `rgba(${INK}, 0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner * squeeze);
    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r * squeeze);
    ctx.stroke();
    if (tick % 10 === 0) {
      ctx.fillStyle = `rgba(${ACCENT}, 0.65)`;
      ctx.fillText(String(tick).padStart(2, "0"), Math.cos(angle) * (r + 15), Math.sin(angle) * (r + 15) * squeeze);
    }
  }
  ctx.restore();
}

function halftone(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  // Keep the dot budget bounded on very wide displays.
  const cell = Math.max(14, Math.ceil(Math.sqrt(w * h / 3500)));
  for (let row = 0, y = cell / 2; y < h; row += 1, y += cell) {
    for (let x = cell / 2 + (row % 2) * cell / 2; x < w; x += cell) {
      const band = Math.sin(x * 0.012 + y * 0.018 - t * 0.55 + Math.sin(y * 0.008 + t * 0.24) * 2);
      const second = Math.cos(x * 0.007 - y * 0.016 + t * 0.3);
      const tide = Math.pow(Math.max(0, (band + second * 0.4 + 1.4) / 2.8), 2);
      const dx = x - field.x;
      const dy = y - field.y;
      const impression = Math.exp(-(dx * dx + dy * dy) / 28000) * field.presence;
      const radius = 0.5 + tide * 3.4 + impression * 1.7;
      const pigment = Math.sin(x * 0.006 + y * 0.009 + t * 0.18) > 0.65;
      ctx.fillStyle = pigment || impression > 0.45 ? `rgba(${ACCENT}, 0.58)` : `rgba(${INK}, 0.34)`;
      ctx.beginPath();
      ctx.arc(x + dx * impression * 0.06, y + dy * impression * 0.06, radius, 0, TAU);
      ctx.fill();
    }
  }
}

/** Soft unprinted space behind the title and register, with stronger ink in the margins. */
function reservePaper(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.translate(width * 0.5, height * 0.47);
  ctx.scale(width * 0.43, height * 0.72);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  wash.addColorStop(0, "rgba(0,0,0,0.99)");
  wash.addColorStop(0.48, "rgba(0,0,0,0.96)");
  wash.addColorStop(0.78, "rgba(0,0,0,0.65)");
  wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(-2, -2, 4, 4);
  ctx.restore();
}

/** A capped 30fps canvas loop. No React renders, WebGL, filters, or offscreen buffers. */
export function attachLandingField(
  root: HTMLElement,
  effect: LandingEffect,
  reduced: boolean,
  initiallyRunning: boolean,
): LandingFieldController {
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>("[data-landing-field]")];
  const surfaces = canvases.flatMap((canvas) => {
    const context = canvas.getContext("2d");
    return context === null ? [] : [{ canvas, context }];
  });
  const primary = surfaces[0];
  if (primary === undefined) return { setRunning: () => undefined, dispose: () => undefined };
  const { canvas, context } = primary;
  const field: Field = { width: 0, height: 0, time: 0, x: 0, y: 0, presence: 0 };
  let dpr = 1;
  let left = 0;
  let top = 0;
  let targetX = 0;
  let targetY = 0;
  let targetPresence = 0;
  let running = initiallyRunning;
  let frame = 0;
  let previous = 0;
  let disposed = false;

  function draw(): void {
    if (field.width === 0 || field.height === 0) return;
    context.clearRect(0, 0, field.width, field.height);
    if (effect === "engraving") engraving(context, field);
    else if (effect === "orrery") orrery(context, field);
    else if (effect === "halftone") halftone(context, field);
    if (effect !== "none") reservePaper(context, field.width, field.height);
    for (const surface of surfaces.slice(1)) {
      surface.context.clearRect(0, 0, field.width, field.height);
      surface.context.drawImage(canvas, 0, 0, field.width, field.height);
    }
  }

  function measure(): void {
    const box = canvas.getBoundingClientRect();
    field.width = canvas.clientWidth;
    field.height = canvas.clientHeight;
    left = box.left;
    top = box.top;
    // Cap both resolution and total pixels; two door faces share the same drawing.
    dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2_000_000 / Math.max(1, field.width * field.height)));
    for (const surface of surfaces) {
      surface.canvas.width = Math.round(field.width * dpr);
      surface.canvas.height = Math.round(field.height * dpr);
      surface.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    draw();
  }

  function step(now: number): void {
    frame = 0;
    if (disposed || !running || reduced || document.hidden) return;
    if (previous === 0 || now - previous >= FRAME_MS - 0.5) {
      const seconds = previous === 0 ? 1 / 30 : Math.min((now - previous) / 1000, 0.1);
      previous = now;
      field.time += seconds;
      const follow = 1 - Math.exp(-seconds * 4);
      field.x += (targetX - field.x) * follow;
      field.y += (targetY - field.y) * follow;
      field.presence += (targetPresence - field.presence) * follow;
      draw();
    }
    frame = requestAnimationFrame(step);
  }

  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }

  function start(): void {
    if (!disposed && running && !reduced && !document.hidden && effect !== "none" && frame === 0 && field.width > 0) {
      frame = requestAnimationFrame(step);
    }
  }

  function move(event: PointerEvent): void {
    if (event.pointerType === "touch" || reduced || !running) return;
    targetX = event.clientX - left;
    targetY = event.clientY - top;
    targetPresence = 1;
  }

  function leave(): void { targetPresence = 0; }
  function visibility(): void { if (document.hidden) stop(); else start(); }
  function resize(): void { measure(); start(); }

  measure();
  start();
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener("resize", resize);
  window.addEventListener("blur", leave);
  root.addEventListener("pointermove", move, { passive: true });
  root.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", visibility);

  return {
    setRunning(next) {
      running = next;
      if (running) start();
      else stop();
    },
    dispose() {
      disposed = true;
      stop();
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", leave);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
