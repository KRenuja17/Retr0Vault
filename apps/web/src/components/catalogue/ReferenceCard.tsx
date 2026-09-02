import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type {
  DesignTypeResponse,
  ReferenceListResponse,
} from "@retr0vault/shared";

import {
  CatalogueCard,
  CatalogueCardBody,
  CatalogueCardFooter,
  CatalogueCardHeader,
  CatalogueCardMedia,
  CountLabel,
  EditorialHeading,
  MonoLabel,
  VocabularyChip,
  VocabularyChipSet,
} from "@/components/primitives";
import type { CatalogueFilter } from "@/lib/catalogue/filters";
import { consumePlateFocus } from "@/lib/catalogue/plateFocus";
import { cx } from "@/lib/cx";

import { ReferenceThumbnail } from "./ReferenceThumbnail";
import styles from "./ReferenceCard.module.css";

/** How many vocabulary terms a plate prints before the `+N` tail. */
const VISIBLE_TAGS = 3;

/*
 * Derived from the list contract rather than redeclared, so `catalogueIndex`
 * keeps the backend's exact optionality and cannot drift from the schema.
 */
export type CatalogueReference = ReferenceListResponse["items"][number];

export interface ReferenceCardProps {
  readonly reference: CatalogueReference;
  /** Total in the current filtered result set, for the `NN / TOTAL` plate number. */
  readonly total: number;
  readonly designType: DesignTypeResponse | undefined;
  /** The first row is fetched eagerly; everything below it lazily. */
  readonly eager?: boolean;
  /** The slice this plate was opened from, so the modal can return to it. */
  readonly origin: CatalogueFilter;
}

/**
 * One catalogue plate, built from real reference data:
 *
 *   [ capture ]
 *   Title                                        design DNA
 *   [term] [term] [term] +N
 *   ◆ Design Type                                     01 / 28
 */
export function ReferenceCard({
  reference,
  total,
  designType,
  eager = false,
  origin,
}: ReferenceCardProps) {
  const isPending = reference.analysisStatus === "pending";
  const visibleTags = reference.tags.slice(0, VISIBLE_TAGS);
  const overflowCount = reference.tags.length - visibleTags.length;
  const padTo = Math.max(2, String(total).length);
  const href = `/reference/${reference.id}`;
  const titleLink = useRef<HTMLAnchorElement>(null);

  // Takes focus back from a sheet that has just closed on this reference.
  useEffect(() => {
    if (consumePlateFocus(reference.id)) {
      titleLink.current?.focus();
    }
  }, [reference.id]);

  return (
    <CatalogueCard interactive className={styles.plate}>
      <CatalogueCardMedia>
        {/*
          * The media and the title point at the same reference. Only the title
          * takes a tab stop, so the plate is a single stop for keyboard users.
          */}
        <Link
          to={href}
          state={{ origin }}
          className={styles.mediaLink}
          tabIndex={-1}
          aria-hidden="true"
        >
          <ReferenceThumbnail
            referenceId={reference.id}
            title={reference.title}
            eager={eager}
          />
        </Link>
      </CatalogueCardMedia>

      <CatalogueCardBody>
        <CatalogueCardHeader
          headline={
            <Link
              ref={titleLink}
              to={href}
              state={{ origin }}
              className={styles.titleLink}
            >
              <EditorialHeading level={3} scale="card" className={styles.title}>
                {reference.title}
              </EditorialHeading>
            </Link>
          }
          aside={
            isPending ? (
              <MonoLabel
                size="small"
                uppercase
                marker="hollow"
                className={styles.pending}
              >
                Awaiting analysis
              </MonoLabel>
            ) : reference.designDNA ? (
              <span className={styles.dna}>{reference.designDNA}</span>
            ) : undefined
          }
        />

        {visibleTags.length > 0 ? (
          <VocabularyChipSet className={styles.tags}>
            {visibleTags.map((tag) => (
              <VocabularyChip key={tag.id} title={`${tag.type}: ${tag.value}`}>
                {tag.value}
              </VocabularyChip>
            ))}
            {overflowCount > 0 ? (
              <VocabularyChip
                overflow
                title={`${overflowCount} more vocabulary terms`}
              >
                {`+${overflowCount}`}
              </VocabularyChip>
            ) : null}
          </VocabularyChipSet>
        ) : null}

        <CatalogueCardFooter
          lead={
            designType ? (
              <MonoLabel
                size="small"
                tone="soft"
                marker="solid"
                className={styles.category}
              >
                {designType.name}
              </MonoLabel>
            ) : (
              <MonoLabel
                size="small"
                tone="muted"
                className={cx(styles.category, styles.unassigned)}
              >
                Unassigned
              </MonoLabel>
            )
          }
          trail={
            reference.catalogueIndex === undefined ? null : (
              <CountLabel
                value={reference.catalogueIndex}
                total={total}
                tone="muted"
                padTo={padTo}
              />
            )
          }
        />
      </CatalogueCardBody>
    </CatalogueCard>
  );
}
