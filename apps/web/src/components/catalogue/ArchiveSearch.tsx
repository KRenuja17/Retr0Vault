import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";

import { ActionButton, MonoLabel } from "@/components/primitives";
import type { CatalogueFilter } from "@/lib/catalogue/filters";

import styles from "./ArchiveSearch.module.css";

/** What the backend index actually covers, said once, under the field. */
const SEARCHED_FIELDS =
  "Matches title, design DNA, thesis, vocabulary, design type, brief, image recipe and source.";

export interface ArchiveSearchProps {
  /** The committed query — what the catalogue is currently showing. */
  readonly query: string;
  readonly onSubmit: (query: string) => void;
  /** The slice being searched, so the scope line can name it. */
  readonly filter: CatalogueFilter;
  readonly label: string;
}

/**
 * The archive's index line. Submitting is explicit: the query goes into the
 * address as `?q=`, so a search is a place you can link to, bookmark and come
 * back to from a reference sheet.
 */
export function ArchiveSearch({
  query,
  onSubmit,
  filter,
  label,
}: ArchiveSearchProps) {
  const [draft, setDraft] = useState(query);
  const inputId = useId();

  // The committed query can change without this field: the back button, a
  // cleared search, or a term chosen from the no-matches plate.
  useEffect(() => setDraft(query), [query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(draft.trim());
  }

  return (
    <form className={styles.search} role="search" onSubmit={submit}>
      <label htmlFor={inputId} className={styles.label}>
        <MonoLabel size="small" uppercase>
          Search
        </MonoLabel>
      </label>

      <span className={styles.entry}>
        <input
          id={inputId}
          className={styles.input}
          type="search"
          value={draft}
          autoComplete="off"
          spellCheck={false}
          placeholder="halftone · large serif · grain"
          onChange={(event) => setDraft(event.target.value)}
        />
      </span>

      <span className={styles.actions}>
        <ActionButton type="submit" variant="solid" size="small">
          Find
        </ActionButton>
        {query.length > 0 ? (
          <ActionButton
            variant="quiet"
            size="small"
            onClick={() => {
              setDraft("");
              onSubmit("");
            }}
          >
            Clear
          </ActionButton>
        ) : null}
      </span>

      <MonoLabel size="micro" tone="muted" className={styles.scope}>
        {filter.kind === "all"
          ? SEARCHED_FIELDS
          : `Searching within ${label}. ${SEARCHED_FIELDS}`}
      </MonoLabel>
    </form>
  );
}

/** Terms that exercise different parts of the index, offered after no matches. */
const SUGGESTED_TERMS = [
  "halftone",
  "large serif",
  "dark editorial",
  "grain",
  "technical mono",
  "orange",
] as const;

export interface SearchSuggestionsProps {
  readonly onChoose: (query: string) => void;
}

export function SearchSuggestions({ onChoose }: SearchSuggestionsProps) {
  return (
    <div className={styles.terms}>
      <MonoLabel size="micro" tone="muted" uppercase>
        Try
      </MonoLabel>
      {SUGGESTED_TERMS.map((term) => (
        <button
          key={term}
          type="button"
          className={styles.term}
          onClick={() => onChoose(term)}
        >
          {term}
        </button>
      ))}
    </div>
  );
}

/** The query as the archive prints it back: mono, in the accent, quoted. */
export function QuotedQuery({ query }: { readonly query: string }) {
  return <span className={styles.quoted}>{`“${query}”`}</span>;
}
