import type { ReactNode } from "react";

import {
  EditorialHeading,
  MonoLabel,
  PageRule,
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
  className,
  children,
}: SectionPanelProps) {
  return (
    <section className={cx(styles.panel, className)}>
      <div className={styles.head}>
        <EditorialHeading
          level={2}
          scale="section"
          marker={marker}
          {...(eyebrow === undefined ? {} : { eyebrow })}
        >
          {title}
        </EditorialHeading>
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
