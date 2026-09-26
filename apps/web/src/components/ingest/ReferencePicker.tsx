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

/**
 * Choose a reference already in the archive: the newest eight until a search
 * is run, then the best matches. Once one is chosen it is printed like a
 * ledger entry, with a way to choose again.
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
  const inputId = useId();
  const results = useQuery({
    queryKey: ["references", `${lane}-picker`, submitted],
    queryFn: ({ signal }) => fetchReferences({ limit: 8, sort: submitted ? "relevance" : "newest", ...(submitted ? { q: submitted } : {}) }, signal),
    enabled: selected === null,
  });

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
              setSubmitted(query.trim());
            }
          }}
        />
        <ActionButton variant="outline" size="small" onClick={() => setSubmitted(query.trim())}>Find</ActionButton>
      </div>
      {results.isPending ? (
        <MonoLabel size="micro" tone="muted" uppercase>Reading the archive</MonoLabel>
      ) : results.isError ? (
        <MonoLabel size="small" className={ingest.fieldError}>{describeIngestFailure(results.error, "read").detail}</MonoLabel>
      ) : results.data.items.length === 0 ? (
        <MonoLabel size="small" tone="muted">{empty}</MonoLabel>
      ) : (
        <ul className={styles.pickerList} aria-label="References">
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
      {footer}
    </div>
  );
}
