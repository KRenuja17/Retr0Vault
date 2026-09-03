/*
 * Field maths for the reactive grid background.
 *
 * Kept out of the component so the contract — how far the pointer reaches, and
 * how far a grid line is ever allowed to move — can be asserted without a
 * canvas. Every number below was tuned against the supplied reference capture:
 * the lattice there measures exactly 50px in both axes, the pointer's influence
 * has decayed into the noise floor by roughly 280px, and the change a viewer
 * actually reads is contrast, not warp. The geometry moves a pixel or three.
 *
 * Two motions are layered: a constant south-easterly drift of the whole
 * lattice, and the pointer's local deformation on top of it.
 */

const TAU = Math.PI * 2;

/** Pitch of the square lattice, in CSS pixels. */
export const GRID_CELL = 50;

/** Distance along a bending line between sampled points, in CSS pixels. */
export const SAMPLE_STEP = 12.5;

/** Beyond this the field is exactly nothing: no shift, no added contrast. */
export const FIELD_RADIUS = 280;

/** Slow breathing that keeps running while the pointer sits still. */
export const IDLE_AMPLITUDE = 1.4;

/**
 * Scales the pull toward the field centre. The product `u * falloff(u)` peaks
 * at ~0.253 near 100px out, so this reads as a ~3px deformation in the band
 * where the effect is strongest, and nothing at all at the rim.
 */
export const POINTER_AMPLITUDE = 12;

/** Hard ceiling on any single displacement, so the lattice stays a lattice. */
export const MAX_DISPLACEMENT = 5.5;

/**
 * Ink alpha away from the pointer, and at the very centre of the field. The
 * resting value lands the lattice about 2.8% darker than the paper: low
 * enough that it stays texture behind the type, high enough that the drift
 * can be read as movement. Crossings compound to twice that, as they do in
 * any grid drawn as separate runs. The field value is what deepens the
 * lattice under the pointer, at roughly five times the resting ink.
 */
export const ALPHA_BASE = 0.028;
export const ALPHA_FIELD = 0.135;

/**
 * Constant south-easterly creep of the whole lattice, in CSS pixels per second
 * along each axis, so one cell passes every six and a quarter seconds. Unlike
 * the pointer field this applies everywhere: the grid is never entirely still.
 */
export const DRIFT_SPEED = 8;

/** Exponential rates, per second: centre inertia, then presence fade. */
export const FIELD_INERTIA = 6.5;
export const PRESENCE_RATE = 3.2;

/* Two slow standing waves per axis. The periods are deliberately coprime-ish
 * (5.0s and 8.1s) so the motion never settles into an obvious pulse. */
const WAVE_K1 = TAU / 210;
const WAVE_K2 = TAU / 330;
const WAVE_W1 = 1.25;
const WAVE_W2 = 0.78;

/**
 * Where the lattice origin has crept to at `time`, wrapped into one cell. The
 * whole drawing window is offset by this, so the lattice translates without
 * the number of lines, or of samples along them, ever changing.
 */
export function driftOffset(time: number): number {
  return (time * DRIFT_SPEED) % GRID_CELL;
}

/** Smoothstep falloff on a normalised 0..1 radius. 1 at the centre, 0 at the rim. */
export function falloffAt(t: number): number {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

/** The same falloff expressed in CSS pixels from the field centre. */
export function falloff(distance: number): number {
  return falloffAt(distance / FIELD_RADIUS);
}

/**
 * Frame-rate independent approach toward a target. `rate` is the reciprocal of
 * the time constant, so the result is identical at 60Hz and 144Hz.
 */
export function approach(
  current: number,
  target: number,
  rate: number,
  seconds: number,
): number {
  return current + (target - current) * (1 - Math.exp(-rate * seconds));
}

/** Horizontal component of the idle wave, in the range [-1, 1]. */
export function idleWaveX(x: number, y: number, time: number): number {
  return (
    Math.sin(y * WAVE_K1 + time * WAVE_W1) * 0.62 +
    Math.sin((x + y) * WAVE_K2 - time * WAVE_W2) * 0.38
  );
}

/** Vertical component of the idle wave, in the range [-1, 1]. */
export function idleWaveY(x: number, y: number, time: number): number {
  return (
    Math.cos(x * WAVE_K1 - time * WAVE_W1 * 0.86) * 0.62 +
    Math.cos((x - y) * WAVE_K2 + time * WAVE_W2) * 0.38
  );
}

/** Clamps a displacement to the lattice's absolute travel limit. */
export function clampShift(value: number): number {
  if (value < -MAX_DISPLACEMENT) return -MAX_DISPLACEMENT;
  if (value > MAX_DISPLACEMENT) return MAX_DISPLACEMENT;
  return value;
}
