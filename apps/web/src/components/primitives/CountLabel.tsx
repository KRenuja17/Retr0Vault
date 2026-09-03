import type { HTMLAttributes } from "react";

import { cx } from "@/lib/cx";

import styles from "./CountLabel.module.css";

export type CountLabelSize = "small" | "regular" | "large";
export type CountLabelTone = "accent" | "ink" | "muted" | "inverse";

export interface CountLabelProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The count itself, or the catalogue position when `total` is supplied. */
  readonly value: number;
  /** When present the label renders as a catalogue index, e.g. `01 / 28`. */
  readonly total?: number;
  readonly size?: CountLabelSize;
  readonly tone?: CountLabelTone;
  /** Minimum digits; catalogue indexes are zero-padded to match the plates. */
  readonly padTo?: number;
}

const sizeClass: Record<CountLabelSize, string | undefined> = {
  small: styles.small,
  regular: styles.regular,
  large: styles.large,
};

const toneClass: Record<CountLabelTone, string | undefined> = {
  accent: undefined,
  ink: styles.toneInk,
  muted: styles.toneMuted,
  inverse: styles.toneInverse,
};

export function padCount(value: number, padTo: number): string {
  const safeValue = Number.isFinite(value) ? Math.trunc(value) : 0;
  const digits = Math.max(0, Math.trunc(padTo));
  return String(Math.abs(safeValue)).padStart(digits, "0");
}

/**
 * Counters and catalogue indexes. Two shapes only: a bare count beside a
 * filter (`28`) and a plate number under a card (`01 / 28`).
 */
export function CountLabel({
  value,
  total,
  size = "regular",
  tone = "accent",
  padTo,
  className,
  ...rest
}: CountLabelProps) {
  const isIndex = typeof total === "number";
  const pad = padTo ?? (isIndex ? 2 : 0);
  const label = isIndex
    ? `${padCount(value, pad)} of ${padCount(total, pad)}`
    : String(value);

  return (
    <span
      className={cx(styles.count, sizeClass[size], toneClass[tone], className)}
      /* The digits are split across aria-hidden spans for typesetting, so the
       * label is the only thing left to announce — and a bare span would not
       * expose it. */
      role="img"
      aria-label={label}
      {...rest}
    >
      <span className={styles.value} aria-hidden="true">
        {padCount(value, pad)}
      </span>
      {isIndex ? (
        <>
          <span className={styles.separator} aria-hidden="true">
            /
          </span>
          <span className={styles.total} aria-hidden="true">
            {padCount(total, pad)}
          </span>
        </>
      ) : null}
    </span>
  );
}
