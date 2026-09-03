import { useState } from "react";

import { ActionButton, ActionLink, MonoLabel } from "@/components/primitives";
import type { CatalogueFilter } from "@/lib/catalogue/filters";
import {
  comparePath,
  directionPath,
  MAX_SELECTION,
  MIN_MULTI_SELECTION,
} from "@/lib/selection/selection";
import type { SelectionState } from "@/lib/selection/SelectionProvider";

import { SelectionExports } from "./SelectionExports";
import styles from "./Selection.module.css";

export interface SelectionBarProps {
  readonly selection: SelectionState;
  /**
   * The slice the marks were made in. Carried into /compare and /direction as
   * history state so closing either sheet returns to this exact view — route,
   * filter and search together.
   */
  readonly origin: CatalogueFilter;
}

/**
 * Marking control for the catalogue, printed in the flow of the page between
 * the search rule and the plates. Deliberately not a floating bar: the archive
 * has no chrome that hovers over its own pages.
 */
export function SelectionBar({ selection, origin }: SelectionBarProps) {
  const [showExports, setShowExports] = useState(false);

  if (!selection.active) {
    return (
      <div className={styles.bar}>
        <MonoLabel size="micro" tone="muted" uppercase>
          Multi-reference
        </MonoLabel>
        <div className={styles.barActions}>
          <ActionButton variant="quiet" size="small" onClick={selection.enter}>
            Select references
          </ActionButton>
        </div>
      </div>
    );
  }

  const { count, ids } = selection;
  const enough = count >= MIN_MULTI_SELECTION;
  const state = { origin };

  return (
    <section className={styles.panel} aria-label="Reference selection">
      <div className={styles.bar}>
        <MonoLabel size="micro" tone="muted" uppercase marker="solid">
          Selection
        </MonoLabel>
        <div className={styles.barActions}>
          <MonoLabel
            size="micro"
            tone={count > 0 ? "soft" : "muted"}
            uppercase
            className={styles.count}
          >
            {`Marked ${String(count).padStart(2, "0")} of ${MAX_SELECTION}`}
          </MonoLabel>
          <ActionButton
            variant="quiet"
            size="small"
            disabled={count === 0}
            onClick={selection.clear}
          >
            Clear
          </ActionButton>
          <ActionButton variant="quiet" size="small" onClick={selection.exit}>
            Done
          </ActionButton>
        </div>
      </div>

      <div className={styles.actions}>
        {enough ? (
          <ActionLink
            variant="solid"
            size="small"
            to={comparePath(ids)}
            state={state}
          >
            Compare
          </ActionLink>
        ) : (
          <ActionButton variant="solid" size="small" disabled>
            Compare
          </ActionButton>
        )}

        {enough ? (
          <ActionLink
            variant="outline"
            size="small"
            to={directionPath(ids)}
            state={state}
          >
            Create direction
          </ActionLink>
        ) : (
          <ActionButton variant="outline" size="small" disabled>
            Create direction
          </ActionButton>
        )}

        <ActionButton
          variant="outline"
          size="small"
          disabled={count === 0}
          aria-expanded={showExports}
          onClick={() => setShowExports((open) => !open)}
        >
          Export
        </ActionButton>

        <MonoLabel size="micro" tone="muted" className={styles.hint}>
          {enough
            ? "Marked plates keep their order; the first is the primary reference."
            : `Mark ${MIN_MULTI_SELECTION} or more plates to compare them or build a direction.`}
        </MonoLabel>
      </div>

      {showExports ? <SelectionExports referenceIds={ids} includeManifest /> : null}
    </section>
  );
}
