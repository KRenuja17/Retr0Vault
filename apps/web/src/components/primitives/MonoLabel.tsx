import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./MonoLabel.module.css";

export type MonoLabelSize = "micro" | "small" | "regular" | "large";
export type MonoLabelTone = "ink" | "soft" | "muted" | "accent" | "inverse";
export type MonoLabelMarker = "none" | "solid" | "hollow" | "square";

export interface MonoLabelProps extends HTMLAttributes<HTMLElement> {
  readonly as?: ElementType;
  readonly size?: MonoLabelSize;
  readonly tone?: MonoLabelTone;
  readonly uppercase?: boolean;
  readonly marker?: MonoLabelMarker;
  readonly children?: ReactNode;
}

const sizeClass: Record<MonoLabelSize, string | undefined> = {
  micro: styles.micro,
  small: styles.small,
  regular: styles.regular,
  large: styles.large,
};

const toneClass: Record<MonoLabelTone, string | undefined> = {
  ink: styles.toneInk,
  soft: styles.toneSoft,
  muted: styles.toneMuted,
  accent: styles.toneAccent,
  inverse: styles.toneInverse,
};

const markerClass: Record<MonoLabelMarker, string | undefined> = {
  none: undefined,
  solid: styles.marker,
  hollow: cx(styles.marker, styles.markerHollow),
  square: cx(styles.marker, styles.markerSquare),
};

/**
 * Every piece of machine-ish text in the archive — field labels, category
 * lines, statuses, marginalia — renders through MonoLabel.
 */
export function MonoLabel({
  as: Component = "span",
  size = "regular",
  tone = "ink",
  uppercase = false,
  marker = "none",
  className,
  children,
  ...rest
}: MonoLabelProps) {
  return (
    <Component
      className={cx(
        styles.label,
        sizeClass[size],
        toneClass[tone],
        uppercase && styles.uppercase,
        markerClass[marker],
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
