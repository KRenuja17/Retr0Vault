import { useState } from "react";
import { Link } from "react-router-dom";
import type { MotionListItem } from "@retr0vault/shared";

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
import { TRIGGER_LABELS } from "@/lib/motion/format";
import { useReducedMotion, useScrubMode } from "@/lib/motion/preferences";

import { MotionPlate } from "./MotionPlate";
import styles from "./MotionCard.module.css";

const VISIBLE_TECHNIQUES = 3;

export interface MotionCardProps {
  readonly item: MotionListItem;
  readonly total: number;
  /** Where the sheet returns to on close: the Motion page's own address. */
  readonly origin: string;
}

/**
 * One Motion plate, the catalogue card's exact anatomy with a moving picture:
 *
 *   [ motion plate ▶ 00:07 / 00:18 ]
 *   Title                                   motion DNA
 *   [technique] [technique] [technique] +N
 *   ◉ Wheel · Load · Time                         04 / 06
 */
export function MotionCard({ item, total, origin }: MotionCardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [explicitPlay, setExplicitPlay] = useState(false);
  const reduced = useReducedMotion();
  const [scrub] = useScrubMode();
  const href = `/motion/${item.referenceId}`;
  const clip = item.primaryClip;
  const visible = item.techniques.slice(0, VISIBLE_TECHNIQUES);
  const overflow = item.techniques.length - visible.length;
  const pending = item.motionStatus === "pending";

  return (
    <CatalogueCard
      interactive
      className={styles.plate}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <CatalogueCardMedia>
        {/*
          * The moving picture opens the same sheet as the title, and only the
          * title takes a tab stop. The link wraps the plate, so pointer
          * movement still reaches it in scrub mode.
          */}
        <Link to={href} state={{ origin }} className={styles.mediaLink} tabIndex={-1} aria-hidden="true">
          <MotionPlate
            clipId={clip?.id ?? null}
            status={clip?.processingStatus ?? null}
            durationMs={clip?.durationMs ?? null}
            keyframeCount={clip?.keyframeCount ?? 0}
            title={item.title}
            active={hovered || focused}
            explicitPlay={explicitPlay}
          />
        </Link>
        {reduced && !scrub && clip?.processingStatus === "ready" ? (
          <button
            type="button"
            className={styles.play}
            aria-pressed={explicitPlay}
            aria-label={`${explicitPlay ? "Pause" : "Play"} ${item.title}`}
            onClick={() => setExplicitPlay((value) => !value)}
          >
            {explicitPlay ? "❚❚ Pause" : "▶ Play"}
          </button>
        ) : null}
      </CatalogueCardMedia>

      <CatalogueCardBody>
        <CatalogueCardHeader
          headline={
            <Link to={href} state={{ origin }} className={styles.titleLink}>
              <EditorialHeading level={2} scale="card" className={styles.title}>
                {item.title}
              </EditorialHeading>
            </Link>
          }
          aside={
            pending ? (
              <MonoLabel size="small" uppercase marker="hollow" className={styles.pending}>
                Awaiting analysis
              </MonoLabel>
            ) : item.motionDNA ? (
              <span className={styles.dna}>{item.motionDNA}</span>
            ) : undefined
          }
        />

        {visible.length > 0 ? (
          <VocabularyChipSet className={styles.tags}>
            {visible.map((technique) => (
              <VocabularyChip key={`${technique.type}:${technique.normalizedValue}`} title={`${technique.type}: ${technique.value}`}>
                {technique.value}
              </VocabularyChip>
            ))}
            {overflow > 0 ? (
              <VocabularyChip overflow title={`${overflow} more techniques`}>{`+${overflow}`}</VocabularyChip>
            ) : null}
          </VocabularyChipSet>
        ) : null}

        <CatalogueCardFooter
          lead={
            <MonoLabel size="small" tone={item.triggers.length > 0 ? "soft" : "muted"} marker="solid" className={styles.triggers}>
              {item.triggers.length > 0
                ? item.triggers.map((trigger) => TRIGGER_LABELS[trigger]).join(" · ")
                : `${item.clipCount} ${item.clipCount === 1 ? "clip" : "clips"}`}
            </MonoLabel>
          }
          trail={
            item.catalogueIndex === undefined ? null : (
              <CountLabel value={item.catalogueIndex} total={total} tone="muted" padTo={Math.max(2, String(total).length)} />
            )
          }
        />
      </CatalogueCardBody>
    </CatalogueCard>
  );
}
