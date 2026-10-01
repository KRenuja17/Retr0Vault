export type LandingEffect = "ribbons" | "orrery" | "halftone" | "constellation" | "shutters" | "none";

export const LANDING_EFFECTS: readonly { id: LandingEffect; name: string; detail: string }[] = [
  { id: "ribbons", name: "Signal ribbons", detail: "Flowing ink traces bend around your pointer. Click the paper to send a wave through them." },
  { id: "orrery", name: "Archive orrery", detail: "Move to tilt the instrument and steer its indexes. Click the paper to ripple its rings." },
  { id: "halftone", name: "Ink tides", detail: "A softer halftone tide. Move to leave a light impression; click the paper to ripple the ink." },
  { id: "constellation", name: "Accession map", detail: "Archive marks drift on fine connecting threads. Move to gather them; click the paper to send a signal." },
  { id: "shutters", name: "Paper shutters", detail: "Folded paper vanes open toward your pointer. Click the paper to set a wave of shutters in motion." },
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
  pulseAge: number;
  pulseX: number;
  pulseY: number;
}

/** One drawing, copied onto both door faces: their print always meets at the seam. */
export interface LandingFieldController {
  setRunning(running: boolean): void;
  dispose(): void;
}

function pulseAt(field: Field, x: number, y: number): number {
  if (field.pulseAge > 3) return 0;
  const distance = Math.hypot(x - field.pulseX, y - field.pulseY);
  const band = (distance - field.pulseAge * 240) / 55;
  return Math.exp(-band * band - field.pulseAge * 1.3);
}

function ribbons(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  for (let line = 0; line < 27; line += 1) {
    const band = Math.floor(line / 3);
    const strand = line % 3;
    ctx.strokeStyle = band % 3 === 0 ? `rgba(${ACCENT}, 0.38)` : `rgba(${INK}, 0.27)`;
    ctx.lineWidth = strand === 1 ? 1.4 : 0.7;
    ctx.beginPath();
    for (let x = -32; x <= w + 32; x += 16) {
      let y = h * (0.03 + band * 0.115) + (strand - 1) * 4
        + Math.sin(x * 0.004 + t * 0.32 + band * 0.52) * h * 0.085
        + Math.cos(x * 0.007 - t * 0.21 + band * 0.3) * h * 0.05;
      const dx = x - field.x;
      const dy = y - field.y;
      const pull = Math.exp(-(dx * dx + dy * dy) / 44000) * field.presence;
      y += dy * pull * 0.32 + pulseAt(field, x, y) * 22;
      if (x === -32) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function orrery(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const radius = Math.max(w * 0.38, h * 0.8);
  const lean = ((field.x / w) - 0.5) * field.presence * 0.65;
  const squeeze = 0.64 + ((field.y / h) - 0.5) * field.presence * 0.26;
  const rotation = -0.2 + Math.sin(t * 0.12) * 0.08 + lean;
  const cx = w * 0.5 + ((field.x / w) - 0.5) * field.presence * 36;
  const cy = h * 0.48 + ((field.y / h) - 0.5) * field.presence * 24;
  const bearing = Math.atan2((field.y - cy) / squeeze, field.x - cx) - rotation;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  for (let ring = 0; ring < 20; ring += 1) {
    const rest = radius * (0.3 + ring * 0.047);
    const ripple = field.pulseAge < 3
      ? Math.sin(rest * 0.02 - field.pulseAge * 8) * Math.exp(-field.pulseAge * 1.4) * 12 : 0;
    const r = rest + ripple;
    const idle = t * (ring % 2 === 0 ? 0.07 : -0.045) + ring * 0.63;
    // Each index follows the pointer around its own orbit, taking the shortest turn.
    const angle = idle + Math.atan2(Math.sin(bearing - idle), Math.cos(bearing - idle)) * field.presence * 0.72;
    ctx.strokeStyle = ring % 5 === 0 ? `rgba(${ACCENT}, 0.48)` : `rgba(${INK}, 0.24)`;
    ctx.lineWidth = ring % 5 === 0 ? 1.35 : 0.8;
    ctx.setLineDash(ring % 3 === 0 ? [3, 9] : []);
    ctx.lineDashOffset = -t * 5;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * squeeze, 0, angle, angle + TAU * 0.88);
    ctx.stroke();
    ctx.setLineDash([]);
    if (ring % 5 === 0 && field.presence > 0.02) {
      ctx.strokeStyle = `rgba(${ACCENT}, ${field.presence * 0.65})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * squeeze, 0, bearing - 0.16, bearing + 0.16);
      ctx.stroke();
    }
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
  const cell = Math.max(16, Math.ceil(Math.sqrt(w * h / 3000)));
  for (let row = 0, y = cell / 2; y < h; row += 1, y += cell) {
    for (let x = cell / 2 + (row % 2) * cell / 2; x < w; x += cell) {
      const band = Math.sin(x * 0.012 + y * 0.018 - t * 0.55 + Math.sin(y * 0.008 + t * 0.24) * 2);
      const second = Math.cos(x * 0.007 - y * 0.016 + t * 0.3);
      const tide = Math.pow(Math.max(0, (band + second * 0.4 + 1.4) / 2.8), 2);
      const dx = x - field.x;
      const dy = y - field.y;
      const impression = Math.exp(-(dx * dx + dy * dy) / 28000) * field.presence;
      const radius = 0.4 + tide * 2.6 + impression * 0.9 + pulseAt(field, x, y) * 0.8;
      const pigment = Math.sin(x * 0.006 + y * 0.009 + t * 0.18) > 0.8;
      ctx.fillStyle = pigment || impression > 0.6 ? `rgba(${ACCENT}, 0.38)` : `rgba(${INK}, 0.23)`;
      ctx.beginPath();
      ctx.arc(x + dx * impression * 0.06, y + dy * impression * 0.06, radius, 0, TAU);
      ctx.fill();
    }
  }
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

function shutters(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const pitch = Math.max(28, w / 42);
  const height = h * 0.26;
  for (let row = 0; row < 3; row += 1) {
    for (let x = pitch / 2, column = 0; x < w; x += pitch, column += 1) {
      const y = h * (0.08 + row * 0.32) + Math.sin(column * 0.25 + t * 0.16) * 10;
      const dx = field.x - x;
      const dy = field.y - (y + height / 2);
      const local = Math.exp(-(dx * dx + dy * dy) / 45000) * field.presence;
      const angle = Math.sin(t * 0.38 + column * 0.22 + row * 0.75) * 1.15
        + local * 1.2 + pulseAt(field, x, y + height / 2) * 0.8;
      const face = Math.cos(angle) * pitch * 0.29;
      const fold = Math.sin(angle) * 9;
      const accent = (column + row * 3) % 9 === 0;
      ctx.fillStyle = `rgba(${accent ? ACCENT : INK}, ${0.055 + Math.abs(Math.sin(angle)) * 0.065})`;
      ctx.strokeStyle = `rgba(${accent ? ACCENT : INK}, ${accent ? 0.35 : 0.23})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - face, y + fold);
      ctx.lineTo(x + face, y - fold);
      ctx.lineTo(x + face, y + height - fold);
      ctx.lineTo(x - face, y + height + fold);
      ctx.lineTo(x - face, y + fold);
      ctx.fill();
      ctx.stroke();
      // The hinge and end notches make the panels read as folded stock.
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y + height);
      ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y);
      ctx.moveTo(x - 2, y + height); ctx.lineTo(x + 2, y + height);
      ctx.stroke();
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
    if (effect === "ribbons") ribbons(context, field);
    else if (effect === "orrery") orrery(context, field);
    else if (effect === "halftone") halftone(context, field);
    else if (effect === "constellation") constellation(context, field);
    else if (effect === "shutters") shutters(context, field);
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
  function press(event: PointerEvent): void {
    if (disposed || reduced || !running || effect === "none" || event.button !== 0) return;
    // A comparison, navigation, or form control must never trigger the paper interaction.
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
