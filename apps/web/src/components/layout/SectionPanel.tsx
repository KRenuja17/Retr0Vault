import type { ReactNode } from "react";

import {
  EditorialHeading,
  MonoLabel,
  PageRule,
  type EditorialHeadingLevel,
} from "@/components/primitives";
import { cx } from "@/lib/cx";

import styles from "./SectionPanel.module.css";

export interface SectionPanelProps {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  /** Mono marginalia printed opposite the title (RISK lines, counts, routes). */
  readonly aside?: ReactNode;
  readonly lede?: ReactNode;
  readonly marker?: boolean;
  /**
   * Heading level for the panel's title. A panel that IS the page — the
   * collection register, accession, a 404 — takes 1; a panel inside a page
   * that already has an h1 keeps the default 2.
   */
  readonly level?: EditorialHeadingLevel;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}

/**
 * The bordered plate used for style-guide headers, empty states and any other
 * block that needs the same paper-and-rule treatment as a catalogue card.
 */
export function SectionPanel({
  eyebrow,
  title,
  aside,
  lede,
  marker = false,
  level = 2,
  className,
  children,
}: SectionPanelProps) {
  return (
    <section className={cx(styles.panel, className)}>
      <div className={styles.head}>
        {/*
          * EditorialHeading prints its eyebrow as a sibling of the heading, so
          * the pair is boxed here: otherwise each becomes its own flex item and
          * the kicker sits beside the title instead of above it.
          */}
        <div className={styles.title}>
          <EditorialHeading
            level={level}
            scale="section"
            marker={marker}
            {...(eyebrow === undefined ? {} : { eyebrow })}
          >
            {title}
          </EditorialHeading>
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
      {children ? <div className={styles.content}>{children}</div> : null}
    </section>
  );
}

export interface ManifestListProps {
  readonly items: readonly string[];
  readonly label?: string;
}

/** A numbered mono list — the archive's substitute for bullet iconography. */
export function ManifestList({ items, label }: ManifestListProps) {
  return (
    <div>
      {label ? (
        <>
          <MonoLabel size="small" tone="muted" uppercase>
            {label}
          </MonoLabel>
          <PageRule weight="hairline" space="tight" />
        </>
      ) : null}
      <ul className={styles.manifest}>
        {items.map((item, index) => (
          <li key={item} className={styles.manifestItem}>
            <MonoLabel size="small" tone="muted" className={styles.manifestIndex}>
              {String(index + 1).padStart(2, "0")}
            </MonoLabel>
            <MonoLabel size="small" tone="soft">
              {item}
            </MonoLabel>
          </li>
        ))}
      </ul>
    </div>
  );
}
