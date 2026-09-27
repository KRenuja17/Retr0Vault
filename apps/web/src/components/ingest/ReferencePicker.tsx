import { useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReferenceResponse } from "@retr0vault/shared";

import { ActionButton, MonoLabel } from "@/components/primitives";
import { fetchReferences } from "@/lib/api/endpoints";
import { cx } from "@/lib/cx";
import { describeIngestFailure } from "@/lib/ingest/errors";

import ingest from "./Ingest.module.css";
import styles from "./ReferencePicker.module.css";

export interface ReferencePickerProps {
  readonly selected: ReferenceResponse | null;
  readonly onSelect: (reference: ReferenceResponse | null) => void;
  /** Keeps each lane's search results apart in the query cache. */
  readonly lane: string;
  /** Printed above the chosen title: "Recording for", "Replacing the picture of". */
  readonly chosenLabel: string;
  /** The search field's accessible name. */
  readonly searchLabel: string;
  readonly describeChosen: (reference: ReferenceResponse) => string;
  readonly describeItem: (reference: ReferenceResponse) => string;
  /** What to say when nothing matches. */
  readonly empty: string;
  /** A way out, printed under the results. */
  readonly footer?: ReactNode;
}

/** The first look is short; "Show all" asks for the most one page can hold. */
const PREVIEW_LIMIT = 8;
const ALL_LIMIT = 100;

/**
 * Choose a reference already in the archive: the newest eight until a search
 * is run, then the best matches, with a count of how many there are and a way
 * to list them all. Once one is chosen it is printed like a ledger entry, with
 * a way to choose again.
 */
export function ReferencePicker({
  selected,
  onSelect,
  lane,
  chosenLabel,
  searchLabel,
  describeChosen,
  describeItem,
  empty,
  footer,
}: ReferencePickerProps) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [showAll, setShowAll] = useState(false);
  const inputId = useId();
  const limit = showAll ? ALL_LIMIT : PREVIEW_LIMIT;
  const results = useQuery({
    queryKey: ["references", `${lane}-picker`, submitted, limit],
    queryFn: ({ signal }) => fetchReferences({ limit, sort: submitted ? "relevance" : "newest", ...(submitted ? { q: submitted } : {}) }, signal),
    enabled: selected === null,
  });

  function search() {
    setSubmitted(query.trim());
    setShowAll(false);
  }

  if (selected !== null) {
    return (
      <div className={styles.chosen}>
        <MonoLabel size="micro" tone="muted" uppercase>{chosenLabel}</MonoLabel>
        <p className={styles.chosenTitle}>{selected.title}</p>
        <MonoLabel size="micro" tone="muted">{describeChosen(selected)}</MonoLabel>
        <ActionButton variant="quiet" size="small" onClick={() => onSelect(null)}>Choose another reference</ActionButton>
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <div className={styles.pickerSearch}>
        <label htmlFor={inputId} className="rv-visually-hidden">{searchLabel}</label>
        <input
          id={inputId}
          className={cx(ingest.control, ingest.controlMono)}
          type="search"
          value={query}
          placeholder="Find a reference: title, DNA, source…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
        />
        <ActionButton variant="outline" size="small" onClick={search}>Find</ActionButton>
      </div>
      {results.isPending ? (
        <MonoLabel size="micro" tone="muted" uppercase>Reading the archive</MonoLabel>
      ) : results.isError ? (
        <MonoLabel size="small" className={ingest.fieldError}>{describeIngestFailure(results.error, "read").detail}</MonoLabel>
      ) : results.data.items.length === 0 ? (
        <MonoLabel size="small" tone="muted">{empty}</MonoLabel>
      ) : (
        <ul className={cx(styles.pickerList, showAll && styles.pickerListAll)} aria-label="References">
          {results.data.items.map((reference) => (
            <li key={reference.id}>
              <button type="button" className={styles.pickerItem} onClick={() => onSelect(reference)}>
                <span className={styles.pickerTitle}>{reference.title}</span>
                <MonoLabel size="micro" tone="muted">{describeItem(reference)}</MonoLabel>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.data !== undefined && results.data.items.length > 0 ? (
        <div className={styles.pickerCount}>
          <MonoLabel size="micro" tone="muted" uppercase role="status">
            {countLine(results.data.items.length, results.data.total, submitted !== "")}
          </MonoLabel>
          {results.data.total > results.data.items.length && !showAll ? (
            <ActionButton variant="quiet" size="small" onClick={() => setShowAll(true)}>
              {submitted ? "Show all matches" : "Show all"}
            </ActionButton>
          ) : showAll && results.data.total > PREVIEW_LIMIT ? (
            <ActionButton variant="quiet" size="small" onClick={() => setShowAll(false)}>Show fewer</ActionButton>
          ) : null}
        </div>
      ) : null}
      {footer}
    </div>
  );
}

/** What the list holds, so a short list is never mistaken for the whole archive. */
function countLine(shown: number, total: number, searching: boolean): string {
  if (shown >= total) return searching ? `${total} ${total === 1 ? "match" : "matches"}` : `Showing all ${total}`;
  return searching ? `Showing ${shown} of ${total} matches` : `Showing the ${shown} newest of ${total}`;
}
