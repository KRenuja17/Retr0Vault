export interface Field {
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

export function pulseAt(field: Field, x: number, y: number): number {
  if (field.pulseAge > 3) return 0;
  const distance = Math.hypot(x - field.pulseX, y - field.pulseY);
  const band = (distance - field.pulseAge * 240) / 55;
  return Math.exp(-band * band - field.pulseAge * 1.3);
}

export function proximity(field: Field, x: number, y: number, spread = 40000): number {
  return Math.exp(-((x - field.x) ** 2 + (y - field.y) ** 2) / spread) * field.presence;
}
