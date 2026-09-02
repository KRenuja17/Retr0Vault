import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./EditorialHeading.module.css";

export type EditorialHeadingLevel = 1 | 2 | 3 | 4;
export type EditorialHeadingScale = "display" | "section" | "card";

export interface EditorialHeadingProps
  extends Omit<HTMLAttributes<HTMLHeadingElement>, "children"> {
  readonly level?: EditorialHeadingLevel;
  readonly scale?: EditorialHeadingScale;
  /** Small mono kicker printed above the title. */
  readonly eyebrow?: ReactNode;
  /** The filled square that opens a design-type title in the style guide. */
  readonly marker?: boolean;
  readonly inverse?: boolean;
  readonly children: ReactNode;
}

const scaleClass: Record<EditorialHeadingScale, string | undefined> = {
  display: styles.display,
  section: styles.section,
  card: styles.card,
};

/**
 * Serif display type. Retr0Vault never sets a heading in the sans or mono
 * families, so every title routes through here.
 */
export function EditorialHeading({
  level = 2,
  scale = "section",
  eyebrow,
  marker = false,
  inverse = false,
  className,
  children,
  ...rest
}: EditorialHeadingProps) {
  const Tag = `h${level}` as const;

  return (
    <>
      {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
      <Tag
        className={cx(
          styles.heading,
          scaleClass[scale],
          inverse && styles.inverse,
          marker && styles.withMarker,
          className,
        )}
        {...rest}
      >
        {marker ? (
          <span className={styles.marker} aria-hidden="true">
            ■
          </span>
        ) : null}
        <span>{children}</span>
      </Tag>
    </>
  );
}
