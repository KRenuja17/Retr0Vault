import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./CatalogueCard.module.css";

export interface CatalogueCardProps extends HTMLAttributes<HTMLElement> {
  /** Renders the plate as an activator (used by the detail modal in F4). */
  readonly interactive?: boolean;
  readonly selected?: boolean;
  readonly children: ReactNode;
}

/**
 * The catalogue plate shell: one thin black rule around a warm paper body,
 * square corners, no shadow, image-first. Content is supplied by the caller
 * through the sub-components below.
 */
export function CatalogueCard({
  interactive = false,
  selected = false,
  className,
  children,
  ...rest
}: CatalogueCardProps) {
  return (
    <article
      className={cx(
        styles.card,
        interactive && styles.interactive,
        selected && styles.selected,
        className,
      )}
      {...rest}
    >
      {children}
    </article>
  );
}

export interface CatalogueCardMediaProps
  extends HTMLAttributes<HTMLDivElement> {
  readonly src?: string | undefined;
  readonly alt?: string;
  /** Shown when there is no image yet, or the image fails to load. */
  readonly fallback?: ReactNode;
  readonly loading?: "lazy" | "eager";
}

export function CatalogueCardMedia({
  src,
  alt = "",
  fallback = "No capture",
  loading = "lazy",
  className,
  children,
  ...rest
}: CatalogueCardMediaProps) {
  return (
    <div className={cx(styles.media, className)} {...rest}>
      {src ? (
        <img src={src} alt={alt} loading={loading} decoding="async" />
      ) : (
        <span className={styles.mediaFallback}>{fallback}</span>
      )}
      {children}
    </div>
  );
}

export function CatalogueCardBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.body, className)} {...rest}>
      {children}
    </div>
  );
}

export interface CatalogueCardHeaderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Serif title, printed lower-left of the plate. */
  readonly headline: ReactNode;
  /** Design DNA, printed opposite the title where the width allows. */
  readonly aside?: ReactNode;
}

export function CatalogueCardHeader({
  headline,
  aside,
  className,
  ...rest
}: CatalogueCardHeaderProps) {
  return (
    <div className={cx(styles.header, className)} {...rest}>
      <div className={styles.headline}>{headline}</div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  );
}

export interface CatalogueCardFooterProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Design type, lower left. */
  readonly lead?: ReactNode;
  /** Catalogue index, lower right. */
  readonly trail?: ReactNode;
}

export function CatalogueCardFooter({
  lead,
  trail,
  className,
  ...rest
}: CatalogueCardFooterProps) {
  return (
    <div className={cx(styles.footer, className)} {...rest}>
      <div>{lead}</div>
      <div>{trail}</div>
    </div>
  );
}

/** The 3-column catalogue grid (2 at tablet, 1 at phone). Never masonry. */
export function CatalogueGrid({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.grid, className)} {...rest}>
      {children}
    </div>
  );
}
