import type { ReactNode } from "react";

import { ActionButton, EditorialHeading, MonoLabel, PageRule } from "@/components/primitives";
import { SectionPanel } from "@/components/layout/SectionPanel";
import type { CatalogueFilter } from "@/lib/catalogue/filters";
import { filterLabel } from "@/lib/catalogue/filters";
import { useReturnToArchive } from "@/lib/selection/useReturnToArchive";

import styles from "./Sheet.module.css";

export interface SheetFrameProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede: string;
  /** Mono marginalia opposite the title — usually the source count. */
  readonly aside: ReactNode;
  readonly origin: CatalogueFilter;
  readonly children: ReactNode;
}

/**
 * The page frame both multi-reference sheets share: a masthead in the archive's
 * own editorial language, a heavy rule, and the way back to the slice the
 * selection was made in. Full width — neither sheet is a dialog.
 */
export function SheetFrame({
  eyebrow,
  title,
  lede,
  aside,
  origin,
  children,
}: SheetFrameProps) {
  const back = useReturnToArchive(origin);

  return (
    <article className={styles.sheet}>
      <div className={styles.masthead}>
        <div className={styles.mastheadText}>
          <MonoLabel size="small" tone="muted" uppercase marker="solid">
            {eyebrow}
          </MonoLabel>
          <EditorialHeading level={1} scale="display" className={styles.title}>
            {title}
          </EditorialHeading>
          <p className={styles.lede}>{lede}</p>
        </div>
        <div className={styles.mastheadMeta}>
          {aside}
          <ActionButton variant="outline" size="small" onClick={back.close}>
            {`Close to ${filterLabel(origin)}`}
          </ActionButton>
        </div>
      </div>

      <PageRule weight="heavy" />

      {children}
    </article>
  );
}

/**
 * What either sheet prints when the address names too few references to work
 * with — a hand-trimmed link, or a selection cleared in another tab.
 */
export function NotEnoughSources({
  minimum,
  origin,
  what,
}: {
  readonly minimum: number;
  readonly origin: CatalogueFilter;
  readonly what: string;
}) {
  const back = useReturnToArchive(origin);

  return (
    <SectionPanel
      eyebrow="Nothing to work from"
      title={`${what} needs at least ${minimum} references`}
      level={1}
      marker
      lede="The address carries fewer than that. Mark plates in the catalogue with SELECT REFERENCES, then choose this action again."
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          Selection too small
        </MonoLabel>
      }
    >
      <ActionButton variant="solid" onClick={back.close}>
        {`Back to ${filterLabel(origin)}`}
      </ActionButton>
    </SectionPanel>
  );
}
