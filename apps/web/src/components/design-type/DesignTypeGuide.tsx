import type { DesignTypeResponse } from "@retr0vault/shared";

import {
  CopyActionButton,
  EditorialHeading,
  MonoLabel,
  PageRule,
  VocabularyChip,
  VocabularyChipSet,
} from "@/components/primitives";
import { briefCopyText, vocabularyCopyText } from "@/lib/designTypes/copyText";
import { cx } from "@/lib/cx";

import styles from "./DesignTypeGuide.module.css";

export interface DesignTypeGuideProps {
  readonly designType: DesignTypeResponse | undefined;
  /** The design-type list has not resolved yet. */
  readonly pending?: boolean;
}

/** Nothing is invented when a field is empty; the gap is stated instead. */
function Absent({ children }: { readonly children: string }) {
  return (
    <MonoLabel size="small" tone="muted" uppercase className={styles.absent}>
      {children}
    </MonoLabel>
  );
}

function RuleList({
  items,
  avoid = false,
  absent,
}: {
  readonly items: readonly string[];
  readonly avoid?: boolean;
  readonly absent: string;
}) {
  if (items.length === 0) {
    return <Absent>{absent}</Absent>;
  }

  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item} className={styles.item}>
          <span
            className={cx(styles.bullet, avoid && styles.bulletAvoid)}
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function GuidePlaceholder() {
  return (
    <div className={styles.guide} aria-hidden="true">
      <div className={cx(styles.plate, styles.identity)}>
        <div className={cx(styles.ghostLine, styles.ghostTitle)} />
        <div className={styles.ghostLine} />
        <div className={cx(styles.ghostLine, styles.ghostShort)} />
      </div>
    </div>
  );
}

/**
 * The design-type style guide: what the style is, where it works, what it
 * risks, the vocabulary that belongs to it, the rules that define it and the
 * anti-patterns that break it — plus the two copy actions that hand any of it
 * to a coding agent.
 *
 * Every value is read from the stored design type. Nothing is hard-coded.
 */
export function DesignTypeGuide({
  designType,
  pending = false,
}: DesignTypeGuideProps) {
  if (designType === undefined) {
    return pending ? <GuidePlaceholder /> : null;
  }

  const vocabularyText = vocabularyCopyText(designType);
  const briefText = briefCopyText(designType);

  return (
    <div className={styles.guide}>
      <section
        className={cx(styles.plate, styles.identity)}
        aria-labelledby="design-type-title"
      >
        <div className={styles.masthead}>
          <EditorialHeading
            level={1}
            scale="section"
            marker
            id="design-type-title"
          >
            {designType.name}
          </EditorialHeading>

          {designType.risk ? (
            <MonoLabel size="small" className={styles.risk}>
              <span className={styles.riskKey}>RISK:</span>
              <span className={styles.riskBody}>{designType.risk}</span>
            </MonoLabel>
          ) : null}
        </div>

        {designType.description ? (
          <p className={styles.summary}>{designType.description}</p>
        ) : (
          <Absent>No summary recorded</Absent>
        )}

        {designType.deployFor ? (
          <p className={styles.deploy}>
            <MonoLabel size="small" uppercase className={styles.deployKey}>
              Deploy for
            </MonoLabel>
            — {designType.deployFor}
          </p>
        ) : (
          <Absent>No deployment guidance recorded</Absent>
        )}

        <div className={styles.vocabulary}>
          <MonoLabel size="small" tone="muted" uppercase>
            Vocabulary
          </MonoLabel>
          <PageRule weight="hairline" space="tight" />
          {designType.vocabulary.length > 0 ? (
            /* The full set: this section exists to expose the whole language,
             * so the catalogue's +N truncation is deliberately not applied. */
            <VocabularyChipSet>
              {designType.vocabulary.map((term) => (
                <VocabularyChip key={term} wrap>
                  {term}
                </VocabularyChip>
              ))}
            </VocabularyChipSet>
          ) : (
            <Absent>No vocabulary recorded</Absent>
          )}
        </div>

        <PageRule weight="dotted" space="regular" />

        <div className={styles.actions}>
          <CopyActionButton
            label="Copy brief block"
            text={briefText}
            variant="solid"
            title="Copy the stored design brief for this type"
          />
          <CopyActionButton
            label="Copy vocab only"
            text={vocabularyText}
            variant="outline"
            title="Copy the vocabulary terms, one per line"
          />
        </div>
      </section>

      <section className={cx(styles.plate, styles.rules)}>
        <div className={styles.column}>
          <MonoLabel
            as="h2"
            size="small"
            tone="muted"
            uppercase
            className={styles.columnHead}
          >
            Principles
          </MonoLabel>
          <RuleList
            items={designType.principles}
            absent="No principles recorded"
          />
        </div>

        <div className={cx(styles.column, styles.columnSecond)}>
          <MonoLabel
            as="h2"
            size="small"
            tone="muted"
            uppercase
            className={styles.columnHead}
          >
            Avoid
          </MonoLabel>
          <RuleList items={designType.avoid} avoid absent="No anti-patterns recorded" />
        </div>
      </section>
    </div>
  );
}
