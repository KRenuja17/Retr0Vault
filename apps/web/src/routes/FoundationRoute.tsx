import { useState } from "react";
import type { ReactNode } from "react";

import { SectionPanel } from "@/components/layout/SectionPanel";
import {
  ActionButton,
  CatalogueCard,
  CatalogueCardBody,
  CatalogueCardFooter,
  CatalogueCardHeader,
  CatalogueCardMedia,
  CatalogueGrid,
  CountLabel,
  EditorialHeading,
  FilterTab,
  ModalSurface,
  MonoLabel,
  PageRule,
  VocabularyChip,
  VocabularyChipSet,
} from "@/components/primitives";

import styles from "./FoundationRoute.module.css";

const PALETTE = [
  { token: "--rv-paper", note: "page ground" },
  { token: "--rv-paper-deep", note: "recessed ground" },
  { token: "--rv-surface", note: "plate surface" },
  { token: "--rv-surface-sunken", note: "chip / recipe" },
  { token: "--rv-surface-inverse", note: "active + solid" },
  { token: "--rv-ink", note: "primary ink" },
  { token: "--rv-ink-muted", note: "marginalia" },
  { token: "--rv-rule-hairline", note: "internal rule" },
  { token: "--rv-accent", note: "counters + marks" },
] as const;

const SPECIMEN_VOCABULARY = [
  "halftone CMYK dot texture",
  "warm paper ground",
  "mono coordinate labels",
] as const;

function Block({
  title,
  note,
  children,
}: {
  readonly title: string;
  readonly note: string;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <MonoLabel size="small" tone="ink" uppercase>
          {title}
        </MonoLabel>
        <MonoLabel size="micro" tone="muted" uppercase>
          {note}
        </MonoLabel>
      </div>
      <PageRule weight="regular" />
      {children}
    </section>
  );
}

/**
 * `/foundation` — the specimen sheet for Retr0Vault's visual system. It is the
 * reference used to check that tokens and primitives still read as one archive.
 */
export function FoundationRoute() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className={styles.sheet}>
      <SectionPanel
        eyebrow="Visual system"
        title="Paper, rule, plate"
        marker
        aside={
          <MonoLabel size="small" tone="muted" uppercase>
            Route · /foundation
          </MonoLabel>
        }
        lede="Retr0Vault is printed matter: a warm paper ground, near-black ink, thin structural rules, square geometry, serif display against monospaced marginalia, and exactly one warm accent held back for counters and marks."
      />

      <Block title="Ground" note="9 tokens">
        <div className={styles.swatches}>
          {PALETTE.map((entry) => (
            <div key={entry.token} className={styles.swatch}>
              <div
                className={styles.swatchChip}
                style={{ backgroundColor: `var(${entry.token})` }}
              />
              <div className={styles.swatchMeta}>
                <MonoLabel size="micro" tone="ink">
                  {entry.token}
                </MonoLabel>
                <MonoLabel size="micro" tone="muted" uppercase>
                  {entry.note}
                </MonoLabel>
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Typography" note="serif display · sans body · mono control">
        <div className={styles.specimen}>
          <div className={styles.specimenRow}>
            <MonoLabel size="micro" tone="muted" uppercase>
              Display
            </MonoLabel>
            <EditorialHeading level={3} scale="display">
              Dither Mono
            </EditorialHeading>
          </div>
          <div className={styles.specimenRow}>
            <MonoLabel size="micro" tone="muted" uppercase>
              Section
            </MonoLabel>
            <EditorialHeading level={3} scale="section">
              Print-Tech Paper
            </EditorialHeading>
          </div>
          <div className={styles.specimenRow}>
            <MonoLabel size="micro" tone="muted" uppercase>
              Plate title
            </MonoLabel>
            <EditorialHeading level={3} scale="card">
              Stillpage
            </EditorialHeading>
          </div>
          <div className={styles.specimenRow}>
            <MonoLabel size="micro" tone="muted" uppercase>
              Body
            </MonoLabel>
            <p className={styles.bodyCopy}>
              Stark black-and-white with bitmap texture. Serif display carrying
              full authority. Split-screen form-plus-art layouts, technical
              marginalia, and grain everywhere.
            </p>
          </div>
          <div className={styles.specimenRow}>
            <MonoLabel size="micro" tone="muted" uppercase>
              Mono
            </MonoLabel>
            <div className={styles.row}>
              <MonoLabel size="regular" tone="ink">
                warm editorial x print DNA
              </MonoLabel>
              <MonoLabel size="small" tone="muted" uppercase marker="solid">
                Print-Tech Paper
              </MonoLabel>
              <MonoLabel size="small" tone="soft" uppercase marker="hollow">
                Awaiting analysis
              </MonoLabel>
            </div>
          </div>
        </div>
      </Block>

      <Block title="Rules" note="hairline · regular · heavy · dotted">
        <PageRule weight="hairline" />
        <PageRule weight="regular" />
        <PageRule weight="heavy" />
        <PageRule weight="dotted" />
      </Block>

      <Block title="Filter tabs" note="square · mono · accent counter">
        <div className={styles.row}>
          <FilterTab label="All" count={28} active />
          <FilterTab label="Print-Tech Paper" count={4} />
          <FilterTab label="Dither Mono" count={5} />
          <FilterTab label="Vast Quiet Cinematic" count={6} />
          <FilterTab label="Reference Styles" count={18} marker />
          <FilterTab label="Empty type" count={0} disabled />
        </div>
      </Block>

      <Block title="Vocabulary" note="chips + overflow tail">
        <VocabularyChipSet>
          {SPECIMEN_VOCABULARY.map((term) => (
            <VocabularyChip key={term}>{term}</VocabularyChip>
          ))}
          <VocabularyChip overflow>+4</VocabularyChip>
          <VocabularyChip selected>selected term</VocabularyChip>
          <VocabularyChip size="small">small</VocabularyChip>
        </VocabularyChipSet>
      </Block>

      <Block title="Counters" note="counts and catalogue indexes">
        <div className={styles.row}>
          <CountLabel value={28} />
          <CountLabel value={1} total={28} />
          <CountLabel value={21} total={28} tone="muted" />
          <CountLabel value={4} tone="ink" size="large" />
        </div>
      </Block>

      <Block title="Actions" note="solid · accent · outline · quiet">
        <div className={styles.row}>
          <ActionButton variant="solid">Copy brief block</ActionButton>
          <ActionButton variant="accent">Copy image recipe</ActionButton>
          <ActionButton variant="outline">Copy vocab only</ActionButton>
          <ActionButton variant="quiet">Reset</ActionButton>
          <ActionButton variant="outline" size="small">
            Small
          </ActionButton>
          <ActionButton variant="solid" disabled>
            Disabled
          </ActionButton>
        </div>
      </Block>

      <Block title="Plate shell" note="3 columns · 8:5 media · no shadow">
        <CatalogueGrid>
          {[
            { title: "Stillpage", dna: "warm editorial x print DNA", index: 1 },
            { title: "SPADE", dna: "print-tech x data", index: 2 },
            { title: "Halftone Sails Collage", dna: "archival x halftone", index: 3 },
          ].map((plate) => (
            <CatalogueCard key={plate.title} interactive>
              <CatalogueCardMedia
                className={styles.placeholderMedia}
                fallback="Reference frame"
              />
              <CatalogueCardBody>
                <CatalogueCardHeader
                  headline={
                    <EditorialHeading level={3} scale="card">
                      {plate.title}
                    </EditorialHeading>
                  }
                  aside={plate.dna}
                />
                <VocabularyChipSet>
                  {SPECIMEN_VOCABULARY.slice(0, 2).map((term) => (
                    <VocabularyChip key={term}>{term}</VocabularyChip>
                  ))}
                  <VocabularyChip overflow>+4</VocabularyChip>
                </VocabularyChipSet>
                <CatalogueCardFooter
                  lead={
                    <MonoLabel size="small" tone="soft" marker="solid">
                      Print-Tech Paper
                    </MonoLabel>
                  }
                  trail={<CountLabel value={plate.index} total={28} tone="muted" />}
                />
              </CatalogueCardBody>
            </CatalogueCard>
          ))}
        </CatalogueGrid>
      </Block>

      <Block title="Modal surface" note="scrim · image first · dotted action rule">
        <div className={styles.row}>
          <ActionButton variant="outline" onClick={() => setModalOpen(true)}>
            Open modal surface
          </ActionButton>
        </div>
        <ModalSurface
          open={modalOpen}
          onOpenChange={setModalOpen}
          label="Modal surface specimen"
          media={
            <div className={styles.modalImage}>
              <MonoLabel size="micro" tone="muted" uppercase>
                Reference frame
              </MonoLabel>
            </div>
          }
          footer={
            <>
              <ActionButton variant="solid">Copy brief</ActionButton>
              <ActionButton variant="accent">Copy image recipe</ActionButton>
              <ActionButton variant="outline" onClick={() => setModalOpen(false)}>
                Close
              </ActionButton>
            </>
          }
        >
          <CatalogueCardHeader
            headline={
              <EditorialHeading level={3} scale="section">
                Stillness
              </EditorialHeading>
            }
            aside="editorial x voxel 3D"
          />
          <p className={styles.bodyCopy} style={{ marginTop: "var(--rv-space-4)" }}>
            The meditation landscape is built from blocks — digital material,
            calm subject.
          </p>
          <VocabularyChipSet style={{ marginTop: "var(--rv-space-5)" }}>
            {[
              "voxel-rendered landscape",
              "pixel mountains and river",
              "serif headline with green emphasis",
              "clean white ground",
            ].map((term) => (
              <VocabularyChip key={term} wrap>
                {term}
              </VocabularyChip>
            ))}
          </VocabularyChipSet>
          <div className={styles.recipe} style={{ marginTop: "var(--rv-space-6)" }}>
            <span className={styles.recipeHead}>IMAGE RECIPE — fill [SUBJECT]</span>
            {"\n\n"}
            [SUBJECT] built entirely from small 3D voxels, miniature diorama
            aesthetic, strict muted palette, soft even lighting, clean ground and
            generous negative space above for typography.
          </div>
        </ModalSurface>
      </Block>
    </div>
  );
}
