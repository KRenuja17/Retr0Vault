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
  pulseAge: number;
  pulseX: number;
  pulseY: number;
}

function pulseAt(field: Field, x: number, y: number): number {
  if (field.pulseAge > 3) return 0;
  const distance = Math.hypot(x - field.pulseX, y - field.pulseY);
  const band = (distance - field.pulseAge * 240) / 55;
  return Math.exp(-band * band - field.pulseAge * 1.3);
}


/** One drawing, copied onto both door faces: their print always meets at the seam. */
export interface LandingFieldController {
  setRunning(running: boolean): void;
  dispose(): void;
}

/** Deterministic accession marks, rather than a repeating lattice or random flicker. */
const MARKS = Array.from({ length: 56 }, (_, index) => ({
  x: ((Math.sin(index * 127.1 + 4) * 43758.5453) % 1 + 1) % 1,
  y: ((Math.sin(index * 311.7 + 8) * 22578.1459) % 1 + 1) % 1,
  phase: index * 2.39996,
}));

function constellation(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const marks = MARKS.map((mark) => {
    const x = mark.x * w + Math.sin(t * 0.16 + mark.phase) * 16;
    const y = mark.y * h + Math.cos(t * 0.13 + mark.phase) * 13;
    const dx = field.x - x;
    const dy = field.y - y;
    const gather = Math.exp(-(dx * dx + dy * dy) / 65000) * field.presence;
    return { x: x + dx * gather * 0.16, y: y + dy * gather * 0.16, gather };
  });
  const reach = Math.max(100, Math.min(230, w * 0.2));
  ctx.font = '8px "JetBrains Mono Variable", monospace';
  for (const [index, mark] of marks.entries()) {
    const neighbours = marks.map((other, position) => ({ position, distance: Math.hypot(mark.x - other.x, mark.y - other.y) }))
      .filter((other) => other.position !== index && other.distance < reach)
      .sort((a, b) => a.distance - b.distance).slice(0, 2);
    for (const neighbour of neighbours) {
      if (neighbour.position < index) continue;
      const other = marks[neighbour.position]!;
      ctx.strokeStyle = `rgba(${mark.gather > 0.25 ? ACCENT : INK}, ${0.12 + mark.gather * 0.18})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(mark.x, mark.y);
      ctx.lineTo(other.x, other.y);
      ctx.stroke();
    }
    const signal = pulseAt(field, mark.x, mark.y);
    ctx.strokeStyle = `rgba(${index % 4 === 0 || mark.gather > 0.3 || signal > 0.3 ? ACCENT : INK}, ${0.38 + mark.gather * 0.3})`;
    const arm = 3 + mark.gather * 3 + signal * 4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mark.x - arm, mark.y); ctx.lineTo(mark.x + arm, mark.y);
    ctx.moveTo(mark.x, mark.y - arm); ctx.lineTo(mark.x, mark.y + arm);
    ctx.stroke();
    if (index % 9 === 0 || mark.gather > 0.65) {
      ctx.fillStyle = `rgba(${INK}, 0.42)`;
      ctx.fillText(`RV-${String(index + 1).padStart(2, "0")}`, mark.x + arm + 5, mark.y - 5);
    }
  }
  if (field.pulseAge < 3) {
    ctx.strokeStyle = `rgba(${ACCENT}, ${Math.exp(-field.pulseAge * 1.8) * 0.45})`;
    ctx.beginPath();
    ctx.arc(field.pulseX, field.pulseY, field.pulseAge * 240, 0, TAU);
    ctx.stroke();
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
  const field: Field = { width: 0, height: 0, time: 0, x: 0, y: 0, presence: 0, pulseAge: Infinity, pulseX: 0, pulseY: 0 };
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
    constellation(context, field);
    reservePaper(context, field.width, field.height);
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
      field.pulseAge += seconds;
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
    if (!disposed && running && !reduced && !document.hidden && frame === 0 && field.width > 0) {
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
  function press(event: PointerEvent): void {
    if (disposed || reduced || !running || event.button !== 0) return;
    // A navigation or form control must never trigger the paper interaction.
    if (event.target instanceof Element && event.target.closest("button, a, input, select, textarea, [role='button']")) return;
    field.pulseAge = 0;
    field.pulseX = event.clientX - left;
    field.pulseY = event.clientY - top;
  }
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
  root.addEventListener("pointerdown", press);
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
      root.removeEventListener("pointerdown", press);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
