import { ActionButton, MonoLabel } from "@/components/primitives";
import {
  exportPendingCombination,
  exportReferenceBriefs,
  exportVocabulary,
} from "@/lib/api/exports";
import { cx } from "@/lib/cx";
import { MIN_MULTI_SELECTION } from "@/lib/selection/selection";

import { useMarkdownExport } from "./useMarkdownExport";
import styles from "./Selection.module.css";

export interface SelectionExportsProps {
  readonly referenceIds: readonly string[];
  /**
   * Offer the combination manifest alongside the reference exports. Off where
   * the manifest has its own worksheet, so /direction does not print it twice.
   */
  readonly includeManifest?: boolean;
  readonly className?: string | undefined;
}

/**
 * The archive's export desk: the three documents the backend can generate from
 * a selection. Every one of them is written by the API and downloaded as it
 * arrives — nothing here composes Markdown.
 *
 * Reference briefs carry the image recipes; the backend has no separate recipe
 * export, so asking for one would return the same document under a name that
 * promised less than it delivered.
 */
export function SelectionExports({
  referenceIds,
  includeManifest = false,
  className,
}: SelectionExportsProps) {
  const exporter = useMarkdownExport();
  const empty = referenceIds.length === 0;
  const canCombine = referenceIds.length >= MIN_MULTI_SELECTION;

  return (
    <div className={cx(styles.exports, className)}>
      <div className={styles.exportRow}>
        <MonoLabel size="micro" tone="muted" uppercase className={styles.exportLead}>
          Export
        </MonoLabel>
        <ActionButton
          variant="outline"
          size="small"
          disabled={empty || exporter.busy}
          onClick={() => {
            void exporter.run("Reference briefs", () =>
              exportReferenceBriefs(referenceIds),
            );
          }}
        >
          Reference briefs
        </ActionButton>
        <ActionButton
          variant="outline"
          size="small"
          disabled={empty || exporter.busy}
          onClick={() => {
            void exporter.run("Vocabulary", () => exportVocabulary(referenceIds));
          }}
        >
          Vocabulary
        </ActionButton>
        {includeManifest ? (
          <ActionButton
            variant="outline"
            size="small"
            disabled={!canCombine || exporter.busy}
            onClick={() => {
              void exporter.run("Combination manifest", () =>
                exportPendingCombination(referenceIds),
              );
            }}
          >
            Combination manifest
          </ActionButton>
        ) : null}
      </div>

      <p className={styles.exportNote}>
        Reference briefs print each selected reference in one Markdown file —
        design DNA, thesis, vocabulary, recorded analysis, design brief, image
        recipe and motion notes — ready for a CLAUDE.md, an AGENTS.md or a
        design-direction.md.
      </p>

      <ExportStatusLine exporter={exporter} />
    </div>
  );
}

/** The outcome of the last export, printed in place rather than as a toast. */
export function ExportStatusLine({
  exporter,
}: {
  readonly exporter: ReturnType<typeof useMarkdownExport>;
}) {
  const { status } = exporter;
  if (status.kind === "idle") {
    return null;
  }

  if (status.kind === "failed") {
    return (
      <p role="alert" className={styles.exportFailed}>
        <MonoLabel size="micro" uppercase marker="hollow">
          {`${status.label} failed`}
        </MonoLabel>
        <span>{status.message}</span>
      </p>
    );
  }

  return (
    <p role="status" className={styles.exportStatus}>
      <MonoLabel size="micro" tone="muted" uppercase>
        {status.kind === "working"
          ? `Generating ${status.label}`
          : `Downloaded ${status.filename}`}
      </MonoLabel>
    </p>
  );
}
