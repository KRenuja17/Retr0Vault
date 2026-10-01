import { proximity, pulseAt, type Field } from "./landingFieldMath";

const TAU = Math.PI * 2;
const INK = "23, 20, 15";
const RUST = "180, 71, 42";

/** Two printed screens slip past each other, producing broad interference bands. */
export function moire(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const pitch = Math.max(7, w / 175);
  for (let layer = 0; layer < 2; layer += 1) {
    const direction = layer === 0 ? 1 : -1;
    ctx.strokeStyle = `rgba(${layer === 0 ? INK : RUST}, ${layer === 0 ? 0.3 : 0.22})`;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let column = -16; column <= w / pitch + 16; column += 1) {
      for (let y = -16; y <= h + 16; y += 12) {
        const rest = column * pitch;
        const local = proximity(field, rest, y, 65000);
        const x = rest + Math.sin(y / h * 4.6 + column * 0.035 + t * 0.19 * direction) * 65
          + Math.sin(y * 0.009 - t * 0.12) * 22 * direction
          + direction * (local * 32 + pulseAt(field, rest, y) * 24);
        if (y === -16) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

/** Thousands of short nib marks behave like iron filings over two moving poles. */
export function magnetic(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const cell = Math.max(15, Math.sqrt(w * h / 2200));
  const poleX = w * (0.24 + Math.sin(t * 0.15) * 0.09);
  const poleY = h * (0.5 + Math.cos(t * 0.2) * 0.22);
  ctx.lineCap = "round";
  for (let row = 0, y = cell / 2; y < h; row += 1, y += cell) {
    for (let x = cell / 2 + row % 2 * cell / 2; x < w; x += cell) {
      const local = proximity(field, x, y, 55000);
      const wave = pulseAt(field, x, y);
      const idle = Math.atan2(y - poleY, x - poleX) - Math.atan2(y - (h - poleY), x - (w - poleX)) + t * 0.06;
      const aim = Math.atan2(y - field.y, x - field.x) + Math.PI / 2;
      const angle = idle + Math.atan2(Math.sin(aim - idle), Math.cos(aim - idle)) * local + wave * Math.PI;
      const length = 3 + local * 5 + wave * 3;
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length;
      const accent = local > 0.4 || wave > 0.25 || Math.sin(x * 0.008 + y * 0.006 + t * 0.2) > 0.91;
      ctx.strokeStyle = `rgba(${accent ? RUST : INK}, ${0.32 + local * 0.3})`;
      ctx.lineWidth = 1 + local * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
    }
  }
  ctx.lineCap = "butt";
}

/** Large offset optical instruments with six blades and a breathing polygonal opening. */
export function irises(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const pitch = Math.max(180, w / 5.3);
  const radius = pitch * 0.44;
  for (let row = -1; row < Math.ceil(h / (pitch * 0.85)) + 1; row += 1) {
    for (let column = -1; column < Math.ceil(w / pitch) + 1; column += 1) {
      const x = column * pitch + (row % 2) * pitch / 2;
      const y = row * pitch * 0.85 + pitch * 0.38;
      const local = proximity(field, x, y, 45000);
      const wave = pulseAt(field, x, y);
      const phase = row * 0.9 + column * 0.65;
      const opening = radius * (0.29 + Math.sin(t * 0.4 + phase) * 0.08 + local * 0.27 + wave * 0.16);
      const rotation = t * 0.055 + phase * 0.16 + local * 0.35;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.strokeStyle = `rgba(${INK}, 0.23)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.stroke();
      for (let blade = 0; blade < 6; blade += 1) {
        const a = blade / 6 * TAU;
        const b = (blade + 1) / 6 * TAU;
        const rim = a + 0.72;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * opening, Math.sin(a) * opening);
        ctx.lineTo(Math.cos(b) * opening, Math.sin(b) * opening);
        ctx.lineTo(Math.cos(rim + TAU / 6) * radius, Math.sin(rim + TAU / 6) * radius);
        ctx.lineTo(Math.cos(rim) * radius, Math.sin(rim) * radius);
        ctx.lineTo(Math.cos(a) * opening, Math.sin(a) * opening);
        const accent = blade === (column - row + 60) % 6;
        ctx.fillStyle = `rgba(${accent ? RUST : INK}, ${accent ? 0.09 + local * 0.1 : 0.025 + blade * 0.008})`;
        ctx.strokeStyle = `rgba(${accent ? RUST : INK}, ${accent ? 0.38 : 0.22})`;
        ctx.fill(); ctx.stroke();
      }
      // Tiny calibration teeth keep the rosettes in the archive's instrument vocabulary.
      ctx.strokeStyle = `rgba(${INK}, 0.3)`;
      ctx.beginPath();
      for (let tick = 0; tick < 24; tick += 1) {
        const a = tick / 24 * TAU;
        ctx.moveTo(Math.cos(a) * (radius + 3), Math.sin(a) * (radius + 3));
        ctx.lineTo(Math.cos(a) * (radius + (tick % 3 === 0 ? 8 : 5)), Math.sin(a) * (radius + (tick % 3 === 0 ? 8 : 5)));
      }
      ctx.stroke(); ctx.restore();
    }
  }
}

/** A continuous sheet of triangular folds; moving the pointer lifts a ridge in the stock. */
export function prisms(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const cell = Math.max(68, w / 17);
  const rows = Math.ceil(h / (cell * 0.82)) + 2;
  const columns = Math.ceil(w / cell) + 3;
  const points = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const x = (column - 1) * cell + row % 2 * cell / 2;
    const y = (row - 1) * cell * 0.82;
    const lift = Math.sin(column * 0.65 + row * 0.7 - t * 0.36) * 0.5 + Math.cos(column * 0.31 - row * 0.55 + t * 0.2) * 0.5;
    const touch = proximity(field, x, y, 50000);
    const wave = pulseAt(field, x, y);
    return { x: x + lift * 9, y: y + lift * 18 - touch * 32 - wave * 23, lift: lift + touch + wave };
  }));
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = points[row]![column]!;
      const b = points[row]![column + 1]!;
      const c = points[row + 1]![column]!;
      const d = points[row + 1]![column + 1]!;
      const facets = row % 2 === 0 ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
      for (const [side, triangle] of facets.entries()) {
        const [p, q, r] = triangle;
        const light = Math.min(1, Math.abs(p!.lift - r!.lift) * 0.55 + (side === 0 ? 0.12 : 0));
        const accent = (column + row * 2) % 11 === 0;
        ctx.fillStyle = `rgba(${accent ? RUST : INK}, ${0.015 + light * (accent ? 0.16 : 0.11)})`;
        ctx.strokeStyle = `rgba(${accent ? RUST : INK}, ${0.1 + light * 0.1})`;
        ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(p!.x, p!.y); ctx.lineTo(q!.x, q!.y); ctx.lineTo(r!.x, r!.y); ctx.lineTo(p!.x, p!.y);
        ctx.fill(); ctx.stroke();
      }
    }
  }
}

const TYPE_MARKS = ["01", "02", "03", "04", "/", "+", "RV", "24", "36", "—", "·", "08"];

/** Rows of movable type travel on invisible currents, lifting into a legible index near the hand. */
export function typography(ctx: CanvasRenderingContext2D, field: Field): void {
  const { width: w, height: h, time: t } = field;
  const cell = Math.max(31, Math.sqrt(w * h / 700));
  const wrap = w + cell * 4;
  for (let row = -1; row <= Math.ceil(h / cell); row += 1) {
    const direction = row % 2 === 0 ? 1 : -1;
    for (let column = 0; column < Math.ceil(wrap / cell); column += 1) {
      const x = ((column * cell + t * direction * 7) % wrap + wrap) % wrap - cell * 2;
      const rest = row * cell + cell / 2;
      const wave = Math.sin(x * 0.008 + row * 0.2 + t * 0.16);
      const y = rest + wave * 22;
      const local = proximity(field, x, y, 24000);
      const signal = pulseAt(field, x, y);
      const index = (column * 7 + row * 3 + 1200) % TYPE_MARKS.length;
      ctx.save();
      ctx.translate(x, y - local * 12 - signal * 17);
      ctx.rotate(Math.cos(x * 0.008 + row * 0.2 + t * 0.16) * 0.19 * (1 - local) + signal * 0.55);
      ctx.font = `${9 + local * 4}px "JetBrains Mono Variable", monospace`;
      ctx.fillStyle = `rgba(${local > 0.35 || signal > 0.25 || index === 6 ? RUST : INK}, ${0.27 + local * 0.45})`;
      ctx.fillText(TYPE_MARKS[index]!, 0, 0);
      if (local > 0.65) {
        ctx.fillRect(0, 5, 12 * local, 0.8);
      }
      ctx.restore();
    }
  }
}
