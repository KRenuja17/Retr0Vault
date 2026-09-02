import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./VocabularyChip.module.css";

export type VocabularyChipSize = "small" | "regular";

export interface VocabularyChipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  readonly size?: VocabularyChipSize;
  /** Long terms wrap instead of truncating (detail views). */
  readonly wrap?: boolean;
  readonly selected?: boolean;
  /** Renders as the muted `+N` tail of a truncated run. */
  readonly overflow?: boolean;
  readonly children: ReactNode;
}

/**
 * A single term of visual vocabulary. Mono, square, hairline-bordered, sitting
 * a shade below the paper so runs of them read as a set rather than buttons.
 */
export function VocabularyChip({
  size = "regular",
  wrap = false,
  selected = false,
  overflow = false,
  className,
  children,
  ...rest
}: VocabularyChipProps) {
  return (
    <span
      className={cx(
        styles.chip,
        size === "small" && styles.small,
        wrap && styles.wrap,
        selected && styles.selected,
        overflow && styles.overflow,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export interface VocabularyChipSetProps
  extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
}

/** Lays out a run of chips with the archive's standard gap. */
export function VocabularyChipSet({
  className,
  children,
  ...rest
}: VocabularyChipSetProps) {
  return (
    <div className={cx(styles.set, className)} {...rest}>
      {children}
    </div>
  );
}
